import { digitsOnly } from "./phone.js";

/**
 * Cliente minimo para enviar mensajes de WhatsApp por la API de Kapso.
 *
 * Mismo contrato que usa el backend actual:
 *   POST {baseUrl}/{phoneNumberId}/messages
 *   header: X-API-Key
 *   body:   { messaging_product, recipient_type, to, type: "text", text: { body } }
 */

export interface SendKapsoTextArgs {
  /** Phone Number ID del numero de negocio (lo trae el webhook de Kapso). */
  phoneNumberId: string;
  /** Telefono del destinatario (cliente). Se normaliza a digitos. */
  to: string;
  /** Texto a enviar (se trunca a 4096 chars como en WhatsApp). */
  body: string;
}

export async function sendKapsoText({
  phoneNumberId,
  to,
  body,
}: SendKapsoTextArgs): Promise<{ messageId?: string }> {
  const apiKey = process.env.KAPSO_API_KEY;
  if (!apiKey) throw new Error("KAPSO_API_KEY no esta configurada");
  if (!phoneNumberId) throw new Error("Falta phoneNumberId para enviar por Kapso");

  const recipient = digitsOnly(to);
  if (!recipient) throw new Error(`Destino invalido para Kapso: "${to}"`);

  const base = String(
    process.env.KAPSO_API_BASE_URL || "https://api.kapso.ai/meta/whatsapp/v24.0",
  ).replace(/\/$/, "");
  const url = `${base}/${phoneNumberId}/messages`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "X-API-Key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: recipient,
      type: "text",
      text: { body: String(body || "").slice(0, 4096) },
    }),
  });

  const raw = await response.text();
  let data: Record<string, unknown> = {};
  try {
    data = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch {
    data = { rawBody: raw.slice(0, 500) };
  }

  if (!response.ok) {
    const err = data as { error?: { message?: string }; message?: string };
    throw new Error(
      err?.error?.message ||
        err?.message ||
        `Fallo al enviar mensaje por Kapso (HTTP ${response.status})`,
    );
  }

  const messages = (data as { messages?: { id?: string }[] }).messages;
  return { messageId: messages?.[0]?.id };
}
