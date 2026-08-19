import { defineTool } from "eve/tools";
import { z } from "zod";
import { getTenant } from "../lib/tenant.js";
import { convertQuoteToOrder } from "../lib/ops/quotes.js";
import { markOrderSyncPending } from "../lib/ops/orders.js";
import { orderIdempotencyKey } from "../lib/idempotency.js";
import { syncOrderCreated } from "../lib/bridge.js";
import { requiresHumanPayment, TRANSFER_HANDOFF_MESSAGE } from "../lib/payment-policy.js";

/**
 * Convierte una cotizacion existente en pedido. Reaplica la regla de direccion
 * obligatoria (si falta, devuelve needsAddress) y la de pago (solo efectivo;
 * transferencia se deriva a una persona sin crear el pedido).
 */
export default defineTool({
  description:
    "Convierte una cotizacion (COT-...) en pedido cuando el cliente decide " +
    "comprar. Requiere direccion (devuelve needsAddress si falta). Solo cierra " +
    "pedidos en efectivo: con transferencia devuelve requiresHuman y no convierte " +
    "nada (hay que derivar con handoff_to_human). Tras convertir, dale al cliente " +
    "el numero de pedido.",
  inputSchema: z.object({
    quoteNumber: z.string().min(3).describe("Numero de la cotizacion a convertir (COT-...)."),
    deliveryAddress: z.string().optional().describe("Direccion de entrega si se dio en el chat."),
    locationId: z.string().uuid().optional().describe("Id de ubicacion guardada confirmada."),
    contactName: z.string().optional().describe("Nombre del cliente si lo proporciono."),
    paymentMethod: z
      .enum(["efectivo", "transferencia"])
      .optional()
      .describe(
        "Forma de pago acordada con el cliente. Solo 'efectivo' convierte la " +
          "cotizacion; 'transferencia' se rechaza y se deriva a una persona.",
      ),
  }),
  async execute(input, ctx) {
    const tenant = getTenant(ctx);
    // Politica de pago: la transferencia la cierra una persona del equipo.
    if (requiresHumanPayment(input.paymentMethod)) {
      return { ok: false, requiresHuman: true, message: TRANSFER_HANDOFF_MESSAGE };
    }
    const result = await convertQuoteToOrder(tenant, {
      ...input,
      idempotencyKey: orderIdempotencyKey(ctx, input),
    });
    if (!result.ok) {
      return { ok: false, needsAddress: result.needsAddress ?? false, message: result.message };
    }
    // En un re-run el pedido ya existia; el Back ya fue notificado. Si falla,
    // se deja marca en el pedido para poder reconciliar.
    if (!result.replayed) {
      const synced = await syncOrderCreated(tenant.organizationId, result.orderId);
      if (!synced) {
        await markOrderSyncPending(tenant, result.orderId).catch(() => {});
      }
    }
    return {
      ok: true,
      orderNumber: result.orderNumber,
      total: result.total,
      note: "Confirma al cliente con el numero de pedido y el total.",
    };
  },
});
