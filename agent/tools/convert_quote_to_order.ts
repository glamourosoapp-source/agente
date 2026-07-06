import { defineTool } from "eve/tools";
import { z } from "zod";
import { getTenant } from "../lib/tenant.js";
import { convertQuoteToOrder } from "../lib/ops/quotes.js";
import { orderIdempotencyKey } from "../lib/idempotency.js";
import { syncOrderCreated } from "../lib/bridge.js";

/**
 * Convierte una cotizacion existente en pedido. Reaplica la regla de direccion
 * obligatoria (si falta, devuelve needsAddress).
 */
export default defineTool({
  description:
    "Convierte una cotizacion (COT-...) en pedido cuando el cliente decide " +
    "comprar. Requiere direccion (devuelve needsAddress si falta). Tras convertir, " +
    "dale al cliente el numero de pedido.",
  inputSchema: z.object({
    quoteNumber: z.string().min(3).describe("Numero de la cotizacion a convertir (COT-...)."),
    deliveryAddress: z.string().optional().describe("Direccion de entrega si se dio en el chat."),
    locationId: z.string().uuid().optional().describe("Id de ubicacion guardada confirmada."),
  }),
  async execute(input, ctx) {
    const tenant = getTenant(ctx);
    const result = await convertQuoteToOrder(tenant, {
      ...input,
      idempotencyKey: orderIdempotencyKey(ctx, input),
    });
    if (!result.ok) {
      return { ok: false, needsAddress: result.needsAddress ?? false, message: result.message };
    }
    await syncOrderCreated(tenant.organizationId, result.orderId);
    return {
      ok: true,
      orderNumber: result.orderNumber,
      total: result.total,
      note: "Confirma al cliente con el numero de pedido y el total.",
    };
  },
});
