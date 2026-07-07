import { createHmac, timingSafeEqual } from "node:crypto";
import { defineChannel, POST } from "eve/channels";
import {
  resolveTenantByPhoneNumberId,
  resolveTenantByBusinessPhone,
} from "../lib/tenant.js";
import { sendKapsoText } from "../lib/kapso.js";
import { toE164 } from "../lib/phone.js";
import { recordInbound, recordInboundMedia, recordOutbound, clearTyping } from "../lib/bridge.js";
import { getConversationState } from "../lib/ops/conversations.js";
import { debounceInboundMessage } from "../lib/message-debounce.js";
import {
  isResetKeyword,
  resetConversation,
  resetMessage,
  conversationToken,
  getGeneration,
} from "../lib/conversation-reset.js";
import type { TenantContext } from "../lib/tenant.js";

/**
 * Canal Kapso / WhatsApp.
 *
 * Recibe el webhook de Kapso, resuelve el tenant (organizacion) desde el numero
 * de negocio, e inicia/reanuda una sesion durable por cliente (continuation
 * token = telefono del cliente). El tenant viaja en `auth.attributes` para que
 * las tools lo lean de forma segura. Las respuestas del agente se envian de
 * vuelta por la API de Kapso en el evento `message.completed`.
 *
 * Webhook publico (apuntar Kapso aqui): POST /webhook (raiz del deployment)
 */

interface KapsoState {
  phoneNumberId: string | null;
  customerPhone: string | null;
}

interface InboundMedia {
  mediaType: "image" | "audio" | "video" | "document";
  kapsoMediaId: string | null;
  mimeType: string | null;
  filename: string | null;
  caption: string | null;
}

interface InboundItem {
  phoneNumberId: string;
  sender: string;
  senderName: string | null;
  text: string;
  direction: string | null;
  type: string | null;
  messageId: string | null;
  media: InboundMedia | null;
}

/** Tipos de mensaje de WhatsApp que portan media -> tipo normalizado. */
const MEDIA_TYPE_MAP: Record<string, InboundMedia["mediaType"]> = {
  image: "image",
  sticker: "image",
  video: "video",
  audio: "audio",
  voice: "audio",
  document: "document",
};

/** Extrae los datos de media de un mensaje de Kapso, o null si es de texto. */
function extractMedia(message: any): InboundMedia | null {
  const type = String(message?.type ?? "");
  const mediaType = MEDIA_TYPE_MAP[type];
  if (!mediaType) return null;
  const block = message?.[type] ?? {};
  const kapsoMediaId = block.id
    ? String(block.id)
    : message?.kapso?.media_id
      ? String(message.kapso.media_id)
      : null;
  // Sin id ni url no hay forma de resolver el archivo; lo tratamos como no-media.
  if (!kapsoMediaId && !message?.kapso?.media_url) return null;
  return {
    mediaType,
    kapsoMediaId,
    mimeType: block.mime_type ?? null,
    filename: block.filename ?? null,
    caption: String(block.caption ?? "").trim() || null,
  };
}

/** Forma de SessionAuthContext (no exportada publicamente por eve). */
interface AuthContext {
  authenticator: string;
  principalType: string;
  principalId: string;
  attributes: Record<string, string | readonly string[]>;
}

/** Firma minima de `send` del canal (inicia/reanuda la sesion durable). */
type SendFn = (
  text: string,
  opts: {
    auth: AuthContext;
    continuationToken: string;
    state: KapsoState;
  },
) => Promise<unknown>;

/**
 * Decide si el agente esta pausado para esta conversacion.
 *
 * Siempre lee el estado actual en Postgres (post-debounce). No usar el inbound
 * del momento t0: un humano puede pausar/escalar durante la ventana de debounce.
 * Regla: responde solo si is_agent_active && !needs_human_review.
 */
async function isAgentPaused(
  tenant: TenantContext,
  customerPhone: string,
): Promise<boolean> {
  try {
    const state = await getConversationState(tenant, customerPhone);
    return (
      !!state &&
      (state.isAgentActive === false || state.needsHumanReview === true)
    );
  } catch {
    // Ante duda (sin estado disponible), no bloquear la atencion del cliente.
    return false;
  }
}

/** Contexto que viaja por el debounce hasta el turno del agente. */
interface AgentTurnMeta {
  item: InboundItem;
  tenant: { organizationId: string };
  customerPhone: string;
  /** Resultado de recordInbound (duplicate check); no usar para guard de pausa. */
  inbound: Awaited<ReturnType<typeof recordInbound>>;
}

/**
 * Persiste el mensaje entrante del cliente de INMEDIATO (visibilidad/realtime
 * individual en el Dashboard, sin esperar el debounce) y, si no es un retry del
 * webhook, lo encola para el turno del agente.
 */
async function handleTextInbound(item: InboundItem, send: SendFn): Promise<void> {
  const tenant =
    (await resolveTenantByPhoneNumberId(item.phoneNumberId)) ??
    (await resolveTenantByBusinessPhone(item.phoneNumberId));
  if (!tenant) return; // numero no registrado: ignorar

  const customerPhone = toE164(item.sender);

  const inbound = await recordInbound({
    organizationId: tenant.organizationId,
    customerPhone,
    contactName: item.senderName,
    text: item.text,
    kapsoMessageId: item.messageId,
  });

  // Retry del webhook (mismo kapsoMessageId): ya esta persistido, no reprocesar
  // para no invocar al agente dos veces por el mismo mensaje.
  if (inbound?.duplicate) return;

  // Encolar para el turno del agente: el debounce fusiona los mensajes seguidos
  // del mismo remitente en un solo turno (el estado mas fresco gana en `meta`).
  const debounceKey = `${item.phoneNumberId}:${item.sender}`;
  await debounceInboundMessage(
    debounceKey,
    item.text,
    { item, tenant, customerPhone, inbound } satisfies AgentTurnMeta,
    async ({ mergedText, meta }) => {
      await processAgentTurn(meta, mergedText, send);
    },
  );
}

/**
 * Turno del agente (corre al vencer el debounce, con el texto ya fusionado):
 * aplica reinicio por palabra clave y el guard de pausa, y si el agente esta
 * activo inicia/reanuda la sesion para responder. La persistencia del inbound ya
 * ocurrio en `handleTextInbound`.
 */
async function processAgentTurn(
  meta: AgentTurnMeta,
  mergedText: string,
  send: SendFn,
): Promise<void> {
  const { item, tenant, customerPhone } = meta;
  const fullTenant: TenantContext = { ...tenant, customerPhone };

  // Palabra clave de reinicio: el agente olvida el contexto y arranca sesion nueva.
  // Se ejecuta aunque la conversacion este escalada a un humano (debe reiniciar
  // igual) y se aisla por numero de negocio (phoneNumberId) para no afectar otros tenants.
  if (isResetKeyword(mergedText)) {
    await resetConversation(customerPhone, item.phoneNumberId);
    const body = resetMessage();
    const sent = await sendKapsoText({ phoneNumberId: item.phoneNumberId, to: customerPhone, body });
    await recordOutbound({
      organizationId: tenant.organizationId,
      customerPhone,
      text: body,
      kapsoMessageId: sent?.messageId ?? null,
    });
    return;
  }

  if (await isAgentPaused(fullTenant, customerPhone)) {
    // Humano en control o conversacion derivada: el agente no responde.
    return;
  }

  const generation = await getGeneration(customerPhone, item.phoneNumberId);
  const auth: AuthContext = {
    authenticator: "kapso",
    principalType: "user",
    principalId: customerPhone,
    attributes: {
      organizationId: tenant.organizationId,
      customerPhone,
      phoneNumberId: item.phoneNumberId,
      // Generacion vigente al iniciar este turno: permite descartar respuestas
      // de una sesion previa si el cliente reinicia mientras Eve sigue trabajando.
      generation: String(generation),
    },
  };

  const continuationToken = conversationToken(customerPhone, generation);
  await send(mergedText, {
    auth,
    continuationToken,
    state: { phoneNumberId: item.phoneNumberId, customerPhone },
  });
}

/**
 * Procesa un mensaje de MEDIA entrante (imagen/audio/video/documento): resuelve
 * tenant y lo persiste para que el equipo lo reciba en el Dashboard. El agente no
 * responde a media (no la procesa); el Back resuelve el mediaUrl en segundo plano.
 */
async function processInboundMedia(item: InboundItem): Promise<void> {
  if (!item.media) return;
  const tenant =
    (await resolveTenantByPhoneNumberId(item.phoneNumberId)) ??
    (await resolveTenantByBusinessPhone(item.phoneNumberId));
  if (!tenant) return; // numero no registrado: ignorar

  const customerPhone = toE164(item.sender);
  await recordInboundMedia({
    organizationId: tenant.organizationId,
    customerPhone,
    contactName: item.senderName,
    mediaType: item.media.mediaType,
    mimeType: item.media.mimeType,
    filename: item.media.filename,
    kapsoMediaId: item.media.kapsoMediaId,
    phoneNumberId: item.phoneNumberId,
    caption: item.media.caption,
    kapsoMessageId: item.messageId,
  });
}

/** Verifica HMAC-SHA256 hex de JSON.stringify(body) contra x-webhook-signature. */
function verifySignature(body: unknown, signature: string | null, secret: string): boolean {
  const sig = String(signature || "").trim();
  if (!secret || !sig) return false;
  const expected = createHmac("sha256", secret).update(JSON.stringify(body)).digest("hex");
  try {
    const a = Buffer.from(sig, "utf8");
    const b = Buffer.from(expected, "utf8");
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function extractPhoneNumberId(payload: any): string {
  return String(payload?.phone_number_id || payload?.conversation?.phone_number_id || "").trim();
}

/** Convierte un pin de ubicacion de WhatsApp en texto enriquecido para el agente. */
function extractLocationText(message: any): string | null {
  const location = message?.location;
  if (!location) return null;
  const latitude = location.latitude;
  const longitude = location.longitude;
  if (latitude == null || longitude == null) return null;
  const label = String(location.name || location.address || "").trim();
  const base = `[Ubicacion compartida] lat:${latitude}, lng:${longitude}`;
  return label ? `${base} — ${label}` : base;
}

/** Aplana el webhook de Kapso (single, batch `data[]` o `events[]`) a items. */
function parseItems(body: any): InboundItem[] {
  const payloads: any[] = Array.isArray(body?.data)
    ? body.data
    : Array.isArray(body?.events)
      ? body.events
      : [body];

  const items: InboundItem[] = [];
  for (const payload of payloads) {
    const message = payload?.message;
    if (!message) continue;
    const sender = String(
      payload?.conversation?.phone_number ||
        message?.from ||
        payload?.conversation?.business_scoped_user_id ||
        "",
    ).trim();
    const senderName =
      String(payload?.conversation?.contact_name || message?.profile?.name || "").trim() || null;
    const media = extractMedia(message);
    const locationText = String(message?.type ?? "") === "location" ? extractLocationText(message) : null;
    const text = media?.caption ?? locationText ?? String(message?.text?.body ?? "").trim();
    items.push({
      phoneNumberId: extractPhoneNumberId(payload),
      sender,
      senderName,
      text,
      direction: message?.kapso?.direction ?? null,
      type: message?.type ?? null,
      messageId: message?.id ? String(message.id) : null,
      media,
    });
  }
  return items;
}

export default defineChannel<KapsoState>({
  state: { phoneNumberId: null, customerPhone: null },

  metadata(state) {
    return { phoneNumberId: state.phoneNumberId, customerPhone: state.customerPhone };
  },

  routes: [
    POST("/webhook", async (req, { send, waitUntil }) => {
      const raw = await req.text();
      let body: unknown;
      try {
        body = raw ? JSON.parse(raw) : {};
      } catch {
        return new Response("invalid json", { status: 400 });
      }

      const secret = (process.env.KAPSO_WEBHOOK_SECRET || "").trim();
      if (secret) {
        const signature =
          req.headers.get("x-webhook-signature") || req.headers.get("X-Webhook-Signature");
        if (!verifySignature(body, signature, secret)) {
          return new Response("invalid signature", { status: 401 });
        }
      }

      const parsed = parseItems(body).filter((item) => {
        if (item.direction === "outbound") return false;
        if (!item.sender || !item.phoneNumberId) return false;
        if (item.media) return true; // media: siempre se procesa
        if (item.type === "location") return Boolean(item.text);
        if (item.type && item.type !== "text") return false;
        if (!item.text) return false;
        return true;
      });

      // Media: se registra de inmediato (sin debounce ni invocar al agente).
      for (const item of parsed.filter((i) => i.media)) {
        waitUntil(processInboundMedia(item));
      }

      // Texto: persistir cada mensaje de inmediato (realtime individual en el
      // Dashboard) y encolar el turno del agente. El debounce fusiona los
      // mensajes seguidos del mismo remitente en un solo turno.
      for (const item of parsed.filter((i) => !i.media)) {
        waitUntil(handleTextInbound(item, send));
      }

      // Responder rapido al webhook; el trabajo del agente sigue en background.
      return Response.json({ ok: true });
    }),
  ],

  events: {
    async "message.completed"(data, _channel, ctx) {
      const attrs = ctx?.session?.auth?.initiator?.attributes as
        | Record<string, string>
        | undefined;
      const phoneNumberId = attrs?.["phoneNumberId"];
      const customerPhone = attrs?.["customerPhone"];
      const organizationId = attrs?.["organizationId"];

      // Respuesta vacia: el agente no dice nada. Apagar "escribiendo..." y salir
      // para que el Dashboard no quede con los puntitos animados.
      const text = data?.message;
      if (!text || !text.trim()) {
        if (organizationId && customerPhone) await clearTyping(organizationId, customerPhone);
        return;
      }

      if (!phoneNumberId || !customerPhone) return;

      // Descartar respuestas de una sesion anterior a un reinicio: si la generacion
      // con la que arranco este turno quedo desfasada, el cliente ya reinicio.
      const turnGeneration = attrs?.["generation"];
      if (turnGeneration != null) {
        const currentGeneration = await getGeneration(customerPhone, phoneNumberId);
        if (Number(turnGeneration) < currentGeneration) {
          // Sesion desfasada: se descarta esta respuesta; apagar "escribiendo...".
          if (organizationId) await clearTyping(organizationId, customerPhone);
          return;
        }
      }

      const sent = await sendKapsoText({ phoneNumberId, to: customerPhone, body: text });

      // Persistir la respuesta del agente en el CRM (hilo del Dashboard + realtime).
      if (organizationId) {
        await recordOutbound({
          organizationId,
          customerPhone,
          text,
          kapsoMessageId: sent?.messageId ?? null,
        });
      }
    },
  },
});
