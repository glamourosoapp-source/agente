import { createHash } from "node:crypto";

/** Forma minima del ctx de una tool con la sesion/turno de eve. */
interface SessionCtxLike {
  session?: { id?: string; turn?: { id?: string } | null } | null;
}

/**
 * Clave de idempotencia para side effects no repetibles (crear pedidos).
 *
 * eve re-ejecuta un paso interrumpido a media ejecucion; sin esta clave, un
 * crash entre el INSERT y el registro del resultado crearia un pedido
 * duplicado al reanudar. La clave se deriva de sesion + turno + hash del
 * input: un re-run del mismo paso produce la MISMA clave (se devuelve el
 * pedido ya creado), mientras que dos pedidos legitimos distintos en el mismo
 * turno producen claves distintas.
 */
export function orderIdempotencyKey(ctx: unknown, payload: unknown): string | null {
  const session = (ctx as SessionCtxLike)?.session;
  const sessionId = session?.id;
  const turnId = session?.turn?.id;
  if (!sessionId || !turnId) return null;
  const inputHash = createHash("sha256")
    .update(JSON.stringify(payload ?? {}))
    .digest("hex")
    .slice(0, 16);
  return `${sessionId}:${turnId}:${inputHash}`;
}
