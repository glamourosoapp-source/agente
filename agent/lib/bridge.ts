/**
 * Cliente HTTP al puente del CRM (Back).
 *
 * Persiste mensajes de WhatsApp y derivaciones en el CRM via la API interna
 * `BACK_INTERNAL_URL/api/internal/agent/*`, autenticada con el header
 * `x-agent-secret` (AGENT_BRIDGE_SECRET).
 *
 * Es TOLERANTE A FALLOS: si Back no responde o no esta configurado, loggea y
 * devuelve null sin romper la respuesta al cliente. La unica decision que
 * depende de Back es la pausa del agente; ante fallo se usa el guard directo a
 * Postgres como respaldo (ver lib/ops/conversations.ts).
 */

function baseUrl(): string {
  return (process.env.BACK_INTERNAL_URL ?? "").replace(/\/$/, "");
}

function secret(): string {
  return process.env.AGENT_BRIDGE_SECRET ?? "";
}

async function post<T>(path: string, body: unknown): Promise<T | null> {
  const base = baseUrl();
  const key = secret();
  if (!base || !key) {
    console.warn(
      `[bridge] BACK_INTERNAL_URL/AGENT_BRIDGE_SECRET no configurados; se omite ${path}`,
    );
    return null;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(`${base}/api/internal/agent${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-agent-secret": key,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout));

    if (!res.ok) {
      console.warn(`[bridge] ${path} respondio HTTP ${res.status}`);
      return null;
    }
    return (await res.json()) as T;
  } catch (error) {
    console.warn(`[bridge] error llamando ${path}:`, error);
    return null;
  }
}

export interface InboundPayload {
  organizationId: string;
  customerPhone: string;
  contactName?: string | null;
  text: string;
  kapsoMessageId?: string | null;
}

export interface InboundResult {
  conversationId: string;
  isAgentActive: boolean;
  needsHumanReview: boolean;
  assignedTo: string | null;
  /** true si el mensaje ya existia (retry del webhook): no reprocesar. */
  duplicate: boolean;
}

export interface InboundMediaPayload {
  organizationId: string;
  customerPhone: string;
  contactName?: string | null;
  mediaType: "image" | "audio" | "video" | "document";
  mimeType?: string | null;
  filename?: string | null;
  kapsoMediaId?: string | null;
  phoneNumberId?: string | null;
  caption?: string | null;
  kapsoMessageId?: string | null;
}

export interface OutboundPayload {
  organizationId: string;
  customerPhone: string;
  text: string;
  kapsoMessageId?: string | null;
}

export interface EscalatePayload {
  organizationId: string;
  customerPhone: string;
  reason: string;
  summary?: string | null;
  suggestedAction?: string | null;
  customerMessage?: string | null;
}

/** Persiste un mensaje entrante y devuelve el estado de la conversacion. */
export function recordInbound(
  payload: InboundPayload,
): Promise<InboundResult | null> {
  return post<InboundResult & { ok: boolean }>("/inbound", payload).then((r) =>
    r
      ? {
          conversationId: r.conversationId,
          isAgentActive: r.isAgentActive,
          needsHumanReview: r.needsHumanReview,
          assignedTo: r.assignedTo,
          duplicate: r.duplicate ?? false,
        }
      : null,
  );
}

/**
 * Persiste un mensaje de MEDIA entrante (imagen/audio/video/documento) del
 * cliente. El Back resuelve el mediaUrl de forma asincrona.
 */
export function recordInboundMedia(
  payload: InboundMediaPayload,
): Promise<InboundResult | null> {
  return post<InboundResult & { ok: boolean }>("/inbound-media", payload).then(
    (r) =>
      r
        ? {
            conversationId: r.conversationId,
            isAgentActive: r.isAgentActive,
            needsHumanReview: r.needsHumanReview,
            assignedTo: r.assignedTo,
            duplicate: r.duplicate ?? false,
          }
        : null,
  );
}

/**
 * Avisa a Back que el agente creo un pedido directo en Postgres, para que
 * dispare notificaciones (order_created) + realtime en el Dashboard. El pedido
 * ya esta persistido; esta llamada solo notifica. Tolerante a fallos.
 */
export function syncOrderCreated(
  organizationId: string,
  orderId: string,
): Promise<{ ok: boolean } | null> {
  return post<{ ok: boolean }>("/order-sync", { organizationId, orderId });
}

/**
 * Apaga el indicador "escribiendo..." en el Dashboard cuando el agente abandona
 * un turno sin responder. Tolerante a fallos.
 */
export function clearTyping(
  organizationId: string,
  customerPhone: string,
): Promise<{ ok: boolean } | null> {
  return post<{ ok: boolean }>("/typing-off", { organizationId, customerPhone });
}

/** Persiste un mensaje saliente del agente (ya enviado por Kapso). */
export function recordOutbound(
  payload: OutboundPayload,
): Promise<{ conversationId: string } | null> {
  return post<{ ok: boolean; conversationId: string }>("/outbound", payload).then(
    (r) => (r ? { conversationId: r.conversationId } : null),
  );
}

/** Marca la conversacion como derivada a humano (notifica + realtime en Back). */
export function escalate(
  payload: EscalatePayload,
): Promise<{ conversationId: string; derivationReason: string } | null> {
  return post<{
    ok: boolean;
    conversationId: string;
    derivationReason: string;
  }>("/escalate", payload).then((r) =>
    r
      ? { conversationId: r.conversationId, derivationReason: r.derivationReason }
      : null,
  );
}
