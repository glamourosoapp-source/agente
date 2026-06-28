import { defineTool } from "eve/tools";
import { z } from "zod";
import { getTenant } from "../lib/tenant.js";
import { createOrder } from "../lib/ops/orders.js";
import { syncOrderCreated } from "../lib/bridge.js";

const itemSchema = z.object({
  productId: z.string().optional(),
  name: z.string().optional(),
  quantity: z.number().positive(),
  notes: z.string().optional(),
});

/**
 * Crea un pedido directamente (caso excepcional). El flujo normal es
 * prepare_order -> confirm_order; usa create_order solo cuando el cliente pide
 * algo claro y ya confirmado en un solo paso. Reaplica la regla de direccion.
 */
export default defineTool({
  description:
    "Crea un pedido en el CRM en un solo paso (caso EXCEPCIONAL). Prefiere " +
    "prepare_order + confirm_order. Requiere direccion (devuelve needsAddress si " +
    "falta). Solo usala cuando el pedido ya este claro y confirmado por el cliente.",
  inputSchema: z.object({
    items: z.array(itemSchema).min(1),
    deliveryAddress: z.string().optional(),
    locationId: z.string().uuid().optional(),
    contactName: z.string().optional(),
    customerNotes: z.string().optional(),
    deliveryFee: z.number().min(0).optional(),
    discount: z.number().min(0).optional(),
  }),
  async execute(input, ctx) {
    const tenant = getTenant(ctx);
    const result = await createOrder(tenant, input);
    if (!result.ok) {
      return { ok: false, needsAddress: result.needsAddress ?? false, message: result.message };
    }
    await syncOrderCreated(tenant.organizationId, result.order.id);
    return {
      ok: true,
      order: {
        orderNumber: result.order.orderNumber,
        status: result.order.status,
        total: result.order.total,
        deliveryAddress: result.order.deliveryAddress,
        items: result.order.items,
      },
    };
  },
});
