import { defineTool } from "eve/tools";
import { z } from "zod";
import { getTenant } from "../lib/tenant.js";
import { getOrderStatus } from "../lib/ops/orders.js";

/**
 * Consulta el estado de un pedido por numero, o el ultimo del cliente.
 */
export default defineTool({
  description:
    "Consulta el estado de un pedido. Si te dan el numero de pedido (ORD-...), " +
    "usalo; si no, devuelve el ultimo pedido del cliente actual. Util para " +
    "'¿como va mi pedido?' o '¿cuando llega?'.",
  inputSchema: z.object({
    orderNumber: z
      .string()
      .optional()
      .describe("Numero de pedido (ORD-YYYYMMDD-NNNN). Omite para el ultimo del cliente."),
  }),
  async execute({ orderNumber }, ctx) {
    const tenant = getTenant(ctx);
    const order = await getOrderStatus(tenant, { orderNumber });
    if (!order) {
      return { ok: true, found: false, message: "No encontre un pedido con esos datos." };
    }
    return { ok: true, found: true, order };
  },
});
