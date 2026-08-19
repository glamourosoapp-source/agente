import { defineTool } from "eve/tools";
import { z } from "zod";
import { getTenant } from "../lib/tenant.js";
import { createOrder, markOrderSyncPending } from "../lib/ops/orders.js";
import { orderIdempotencyKey } from "../lib/idempotency.js";
import { syncOrderCreated } from "../lib/bridge.js";
import { requiresHumanPayment, TRANSFER_HANDOFF_MESSAGE } from "../lib/payment-policy.js";

const itemSchema = z.object({
  productId: z.string().optional(),
  name: z.string().optional(),
  quantity: z.number().int().positive().max(500),
  notes: z.string().optional(),
});

/**
 * Crea un pedido directamente (caso excepcional). El flujo normal es
 * prepare_order -> confirm_order; usa create_order solo cuando el cliente pide
 * algo claro y ya confirmado en un solo paso. Reaplica la regla de direccion y
 * la de pago (solo efectivo; transferencia se deriva a una persona).
 */
export default defineTool({
  description:
    "Crea un pedido en el CRM en un solo paso (caso EXCEPCIONAL). Prefiere " +
    "prepare_order + confirm_order. Requiere direccion (devuelve needsAddress si " +
    "falta). Solo cierra pedidos en efectivo: con transferencia devuelve " +
    "requiresHuman y no crea nada (hay que derivar con handoff_to_human). Solo " +
    "usala cuando el pedido ya este claro y confirmado por el cliente.",
  inputSchema: z.object({
    items: z.array(itemSchema).min(1),
    deliveryAddress: z.string().optional(),
    locationId: z.string().uuid().optional(),
    contactName: z.string().optional(),
    customerNotes: z.string().optional(),
    paymentMethod: z.enum(["efectivo", "transferencia"]).optional(),
    // Sin deliveryFee ni discount: el envio lo calcula la politica del negocio
    // y los descuentos solo los autoriza una persona del equipo (handoff).
  }),
  async execute(input, ctx) {
    const tenant = getTenant(ctx);
    // Politica de pago: la transferencia la cierra una persona del equipo.
    if (requiresHumanPayment(input.paymentMethod)) {
      return { ok: false, requiresHuman: true, message: TRANSFER_HANDOFF_MESSAGE };
    }
    const result = await createOrder(tenant, {
      ...input,
      idempotencyKey: orderIdempotencyKey(ctx, input),
    });
    if (!result.ok) {
      return {
        ok: false,
        needsAddress: result.needsAddress ?? false,
        unavailable: result.unavailable,
        message: result.message,
      };
    }
    // En un re-run el pedido ya existia; el Back ya fue notificado. Si falla,
    // se deja marca en el pedido para poder reconciliar.
    if (!result.replayed) {
      const synced = await syncOrderCreated(tenant.organizationId, result.order.id);
      if (!synced) {
        await markOrderSyncPending(tenant, result.order.id).catch(() => {});
      }
    }
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
