/**
 * Cliente Redis (Upstash) para estado compartido entre instancias serverless.
 *
 * En Vercel (Fluid Compute) el estado en memoria de un proceso no se comparte
 * entre instancias. Para coordinacion de corta vida (debounce, locks ligeros)
 * usamos Upstash Redis via Marketplace, que auto-provisiona estas variables.
 *
 * Si no hay credenciales (p. ej. desarrollo local sin integracion), devolvemos
 * null y el llamador usa su fallback en memoria.
 */
import { Redis } from "@upstash/redis";

let client: Redis | null = null;
let resolved = false;

export function getRedis(): Redis | null {
  if (resolved) return client;
  resolved = true;

  const url =
    process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || "";
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || "";

  if (!url || !token) {
    client = null;
    return client;
  }

  client = new Redis({ url, token });
  return client;
}
