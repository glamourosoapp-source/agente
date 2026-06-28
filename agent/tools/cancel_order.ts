import { defineTool } from "eve/tools";
import { z } from "zod";
import { getTenant } from "../lib/tenant.js";
import { cancelOrder } from "../lib/ops/orders.js";

/**
 * Cancela un pedido del cliente actual. Politica: solo pedidos en estado `new`
 * (recien creados) del propio cliente. Si ya esta en proceso/entregado, el
 * agente NO cancela: debe derivar a una persona del equipo.
 */
export default defineTool({
  description:
    "Cancela un pedido del cliente actual por su numero (ORD-...). Solo se pueden " +
    "cancelar pedidos recien creados (estado 'new'). Si el pedido ya esta en " +
    "proceso o entregado, NO se cancela aqui: usa handoff_to_human para que una " +
    "persona lo gestione. Confirma con el cliente antes de cancelar.",
  inputSchema: z.object({
    orderNumber: z.string().min(3).describe("Numero del pedido a cancelar (ORD-YYYYMMDD-NNNN)."),
  }),
  async execute({ orderNumber }, ctx) {
    const tenant = getTenant(ctx);
    const result = await cancelOrder(tenant, { orderNumber });
    if (result.ok) {
      return {
        ok: true,
        cancelled: true,
        orderNumber: result.orderNumber,
        message: `Pedido ${result.orderNumber} cancelado. Confirma al cliente.`,
      };
    }
    return {
      ok: false,
      cancelled: false,
      reason: result.reason,
      status: result.reason === "not_cancellable" ? result.status : undefined,
      message: result.message,
      // Pista para el modelo: si no es cancelable, derivar a humano.
      shouldHandoff: result.reason === "not_cancellable",
    };
  },
});
