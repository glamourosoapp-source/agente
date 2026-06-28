/**
 * Reinicio de conversacion por palabra clave.
 *
 * Cuando el cliente envia la palabra clave (CONVERSATION_RESET_KEYWORD), el
 * agente "olvida" el contexto previo y arranca una sesion durable nueva.
 *
 * Como Eve continua la sesion por `continuationToken` (= telefono del cliente),
 * el reinicio se hace incrementando una "generacion" por cliente y anexandola
 * al token: el runtime no encuentra una sesion parkeada bajo el token nuevo y
 * empieza desde cero. La generacion vive en Redis (compartida entre instancias)
 * con fallback en memoria para desarrollo local.
 *
 * La generacion se aisla por `scope` (numero de negocio / phoneNumberId) para que
 * un reinicio en una organizacion no afecte al mismo telefono en otra.
 */
import { getRedis } from "./redis.js";

const genFallback = new Map<string, number>();

/** Palabra clave configurada (vacia = funcion desactivada). */
export function resetKeyword(): string {
  return (process.env.CONVERSATION_RESET_KEYWORD || "").trim();
}

/** Mensaje de confirmacion al reiniciar. */
export function resetMessage(): string {
  return (
    process.env.CONVERSATION_RESET_MESSAGE ||
    "Listo, reinicie nuestra conversacion. ¿En que te puedo ayudar?"
  );
}

/** True si el texto del cliente es exactamente la palabra clave (sin distinguir mayusculas). */
export function isResetKeyword(text: string): boolean {
  const keyword = resetKeyword();
  if (!keyword) return false;
  return text.trim().toLowerCase() === keyword.toLowerCase();
}

function genKey(scope: string, customerPhone: string): string {
  return `conv:gen:${scope}:${customerPhone}`;
}

/** Lee la generacion actual del cliente en el scope (0 si nunca se reinicio). */
export async function getGeneration(customerPhone: string, scope: string): Promise<number> {
  const redis = getRedis();
  const key = genKey(scope, customerPhone);
  if (redis) {
    const value = await redis.get<number>(key);
    return typeof value === "number" ? value : Number(value) || 0;
  }
  return genFallback.get(key) ?? 0;
}

/**
 * Token de continuacion para una generacion dada.
 * Generacion 0 -> telefono pelado (compatibilidad con sesiones existentes).
 */
export function conversationToken(customerPhone: string, generation: number): string {
  return generation > 0 ? `${customerPhone}#g${generation}` : customerPhone;
}

/** Token de continuacion vigente para el cliente en el scope. */
export async function getConversationToken(
  customerPhone: string,
  scope: string,
): Promise<string> {
  const gen = await getGeneration(customerPhone, scope);
  return conversationToken(customerPhone, gen);
}

/** Incrementa la generacion: la siguiente interaccion arranca sesion nueva. */
export async function resetConversation(customerPhone: string, scope: string): Promise<void> {
  const redis = getRedis();
  const key = genKey(scope, customerPhone);
  if (redis) {
    await redis.incr(key);
    return;
  }
  genFallback.set(key, (genFallback.get(key) ?? 0) + 1);
}
