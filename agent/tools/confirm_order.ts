import { defineTool } from "eve/tools";
import { z } from "zod";
import { getTenant } from "../lib/tenant.js";
import { createOrder } from "../lib/ops/orders.js";
import { orderIdempotencyKey } from "../lib/idempotency.js";
import { syncOrderCreated } from "../lib/bridge.js";

const itemSchema = z.object({
  productId: z.string().optional().describe("Id del producto (preferido)."),
  name: z.string().optional().describe("Nombre del producto si no tienes el id."),
  quantity: z.number().positive().describe("Cantidad solicitada."),
  notes: z.string().optional().describe("Nota del item (opcional)."),
});

/**
 * Crea el pedido en el CRM tras la confirmacion explicita del cliente. Es el
 * paso final del flujo canonico (search_products -> prepare_order -> confirmacion
 * -> confirm_order). Reaplica la regla de direccion obligatoria.
 */
export default defineTool({
  description:
    "Crea el pedido en el CRM. LLAMALA SOLO despues de que el cliente confirme " +
    "explicitamente el resumen de prepare_order y de conocer su forma de pago " +
    "(efectivo o transferencia). Si falta direccion devuelve needsAddress: pidela " +
    "y no insistas en crear. Si un producto se agoto devuelve unavailable. Tras " +
    "crearlo, dale al cliente el numero de pedido; si paga por transferencia, " +
    "pidele el comprobante (se registra con process_document).",
  inputSchema: z.object({
    items: z.array(itemSchema).min(1).describe("Productos confirmados del pedido."),
    deliveryAddress: z.string().optional().describe("Direccion de entrega (si se dio en el chat)."),
    locationId: z
      .string()
      .uuid()
      .optional()
      .describe("Id de ubicacion guardada confirmada por el cliente."),
    contactName: z.string().optional().describe("Nombre del cliente si lo proporciono."),
    customerNotes: z.string().optional().describe("Notas del cliente para el pedido (opcional)."),
    paymentMethod: z
      .enum(["efectivo", "transferencia"])
      .optional()
      .describe("Forma de pago acordada con el cliente (efectivo o transferencia)."),
    deliveryFee: z
      .number()
      .min(0)
      .optional()
      .describe("Costo de envio SOLO para casos especiales; normalmente se calcula solo."),
    discount: z.number().min(0).optional(),
  }),
  async execute(input, ctx) {
    const tenant = getTenant(ctx);
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

    // Notifica al Back para realtime + notificacion en el Dashboard (best-effort).
    // En un re-run el pedido ya existia; el Back ya fue notificado.
    if (!result.replayed) await syncOrderCreated(tenant.organizationId, result.order.id);

    return {
      ok: true,
      order: {
        orderNumber: result.order.orderNumber,
        status: result.order.status,
        subtotal: result.order.subtotal,
        total: result.order.total,
        deliveryAddress: result.order.deliveryAddress,
        items: result.order.items,
      },
      note: "Confirma al cliente con el numero de pedido y el total.",
    };
  },
});
