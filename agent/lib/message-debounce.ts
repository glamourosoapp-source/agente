/**
 * Agrupa mensajes consecutivos del mismo cliente antes de invocar al agente.
 *
 * WhatsApp/Kapso suele entregar varios textos seguidos ("Hola" + el pedido).
 * Esperamos un breve debounce y concatenamos en un solo turno.
 *
 * Coordinacion entre instancias (Vercel Fluid Compute): el estado vive en Upstash
 * Redis cuando hay credenciales, para que webhooks del mismo cliente que caen en
 * instancias distintas se fusionen igual. Sin Redis (dev local) se usa un fallback
 * en memoria por proceso.
 */
import { randomUUID } from "node:crypto";
import { getRedis } from "./redis.js";

export interface DebouncePayload<T> {
  key: string;
  mergedText: string;
  meta: T;
}

type FlushFn<T> = (payload: DebouncePayload<T>) => void | Promise<void>;

interface PendingEntry<T> {
  texts: string[];
  meta: T;
  timer: ReturnType<typeof setTimeout>;
  /** Todos los webhooks fusionados en esta ventana deben resolverse al hacer flush. */
  resolvers: Array<() => void>;
}

const pending = new Map<string, PendingEntry<unknown>>();

export const DEFAULT_DEBOUNCE_MS = Number(process.env.KAPSO_MESSAGE_DEBOUNCE_MS) || 2800;

/** Margen extra de TTL para que las claves se autolimpien tras la ventana. */
const TTL_BUFFER_MS = 30_000;

/**
 * Claim atomico: si el token guardado sigue siendo el nuestro (somos el ultimo
 * mensaje de la ventana), devolvemos todos los textos acumulados y limpiamos.
 * Si no, devolvemos lista vacia (otro webhook posterior hara el flush).
 */
const CLAIM_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  local texts = redis.call('LRANGE', KEYS[2], 0, -1)
  redis.call('DEL', KEYS[1], KEYS[2])
  return texts
else
  return {}
end
`;

/** Une items del mismo remitente dentro de un webhook Kapso. */
export function mergeSameSenderTexts<T extends { text: string }>(
  items: T[],
  keyFn: (item: T) => string,
): Array<T & { text: string }> {
  const map = new Map<string, T & { text: string }>();
  for (const item of items) {
    const key = keyFn(item);
    const prev = map.get(key);
    if (prev) {
      map.set(key, { ...item, text: `${prev.text}\n${item.text}`.trim() });
    } else {
      map.set(key, { ...item });
    }
  }
  return [...map.values()];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Variante Redis: coordina el merge entre instancias.
 *
 * Cada mensaje empuja su texto, marca su token como el ultimo y, tras el
 * debounce, intenta reclamar. Solo el ultimo mensaje de la ventana gana el
 * claim y ejecuta el flush con su propio `meta` (el mas reciente).
 */
async function debounceWithRedis<T>(
  redis: NonNullable<ReturnType<typeof getRedis>>,
  key: string,
  text: string,
  meta: T,
  onFlush: FlushFn<T>,
  debounceMs: number,
): Promise<void> {
  const token = randomUUID();
  const tokenKey = `debounce:${key}:token`;
  const textsKey = `debounce:${key}:texts`;
  const ttlMs = debounceMs + TTL_BUFFER_MS;

  await redis.rpush(textsKey, text);
  await redis.pexpire(textsKey, ttlMs);
  await redis.set(tokenKey, token, { px: ttlMs });

  await sleep(debounceMs);

  const texts = (await redis.eval(CLAIM_SCRIPT, [tokenKey, textsKey], [token])) as
    | string[]
    | null;

  if (!texts || texts.length === 0) return; // otro mensaje posterior hara el flush

  const mergedText = texts.join("\n").trim();
  await onFlush({ key, mergedText, meta });
}

/** Variante en memoria (fallback para dev local sin Redis). */
function debounceInMemory<T>(
  key: string,
  text: string,
  meta: T,
  onFlush: FlushFn<T>,
  debounceMs: number,
): Promise<void> {
  return new Promise((resolve) => {
    const existing = pending.get(key) as PendingEntry<T> | undefined;

    if (existing) {
      clearTimeout(existing.timer);
      existing.texts.push(text);
      existing.meta = meta;
      existing.resolvers.push(resolve);
      existing.timer = setTimeout(async () => {
        pending.delete(key);
        const mergedText = existing.texts.join("\n").trim();
        try {
          await onFlush({ key, mergedText, meta: existing.meta });
        } finally {
          for (const r of existing.resolvers) r();
        }
      }, debounceMs);
      pending.set(key, existing as PendingEntry<unknown>);
      return;
    }

    const entry: PendingEntry<T> = {
      texts: [text],
      meta,
      resolvers: [resolve],
      timer: setTimeout(async () => {
        pending.delete(key);
        const mergedText = entry.texts.join("\n").trim();
        try {
          await onFlush({ key, mergedText, meta: entry.meta });
        } finally {
          for (const r of entry.resolvers) r();
        }
      }, debounceMs),
    };
    pending.set(key, entry as PendingEntry<unknown>);
  });
}

/**
 * Encola un mensaje y devuelve una promesa que resuelve tras el debounce.
 * Pasar esa promesa a `waitUntil` del canal para que Vercel no corte el trabajo.
 */
export function debounceInboundMessage<T>(
  key: string,
  text: string,
  meta: T,
  onFlush: FlushFn<T>,
  debounceMs = DEFAULT_DEBOUNCE_MS,
): Promise<void> {
  const redis = getRedis();
  if (redis) {
    return debounceWithRedis(redis, key, text, meta, onFlush, debounceMs);
  }
  return debounceInMemory(key, text, meta, onFlush, debounceMs);
}
