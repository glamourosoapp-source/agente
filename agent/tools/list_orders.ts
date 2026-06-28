import { defineTool } from "eve/tools";
import { z } from "zod";
import { getTenant } from "../lib/tenant.js";
import { listOrders } from "../lib/ops/orders.js";

/**
 * Lista los pedidos anteriores del cliente actual (historial). Usar para
 * "mis pedidos", "que he comprado", "mi ultimo pedido fue...", etc.
 */
export default defineTool({
  description:
    "Lista los pedidos anteriores del cliente actual (del mas reciente al mas " +
    "antiguo): numero, fecha, total, cantidad de productos y estado. Usala cuando " +
    "el cliente pregunta por su historial o 'mis pedidos'. Para el detalle de uno " +
    "en particular usa get_order_status con el numero.",
  inputSchema: z.object({
    limit: z
      .number()
      .int()
      .min(1)
      .max(20)
      .optional()
      .describe("Cuantos pedidos traer (por defecto 5)."),
  }),
  async execute({ limit }, ctx) {
    const tenant = getTenant(ctx);
    if (!tenant.customerPhone) {
      return { ok: false, message: "No tengo el telefono del cliente en este turno." };
    }
    const orders = await listOrders(tenant, { limit });
    if (orders.length === 0) {
      return { ok: true, found: false, message: "Este cliente no tiene pedidos anteriores." };
    }
    return { ok: true, found: true, count: orders.length, orders };
  },
});
