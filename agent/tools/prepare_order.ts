import { defineTool } from "eve/tools";
import { z } from "zod";
import { getTenant } from "../lib/tenant.js";
import { prepareOrder } from "../lib/ops/orders.js";

const itemSchema = z.object({
  productId: z.string().optional().describe("Id del producto (preferido, de search_products)."),
  name: z.string().optional().describe("Nombre del producto si no tienes el id."),
  quantity: z.number().positive().describe("Cantidad solicitada."),
  notes: z.string().optional().describe("Nota del item (opcional)."),
});

/**
 * Arma el resumen del pedido (productos, cantidades, precios y total) SIN crearlo.
 * Paso 2 obligatorio del flujo: search_products -> prepare_order -> confirmacion -> confirm_order.
 */
export default defineTool({
  description:
    "Arma el resumen del pedido (items, precios, subtotal, envio y total) SIN " +
    "crearlo. Usala despues de search_products y antes de confirm_order. Si el " +
    "cliente no tiene direccion guardada y no la pasas, devuelve needsAddress: " +
    "pidela antes de continuar. Si algun producto esta agotado devuelve " +
    "unavailable: avisa al cliente y ofrece alternativas. El costo de envio se " +
    "calcula solo (gratis desde el minimo del negocio). Muestra el resumen al " +
    "cliente y pide su confirmacion explicita.",
  inputSchema: z.object({
    items: z.array(itemSchema).min(1).describe("Productos del pedido."),
    deliveryAddress: z
      .string()
      .optional()
      .describe("Direccion de entrega si el cliente la da ahora (si no, se usa la guardada)."),
    locationId: z
      .string()
      .uuid()
      .optional()
      .describe("Id de una ubicacion guardada del cliente (de list_customer_locations)."),
    contactName: z.string().optional().describe("Nombre del cliente si lo proporciona."),
    paymentMethod: z
      .enum(["efectivo", "transferencia"])
      .optional()
      .describe("Forma de pago si el cliente ya la indico (efectivo o transferencia)."),
    deliveryFee: z
      .number()
      .min(0)
      .optional()
      .describe("Costo de envio SOLO para casos especiales; normalmente se calcula solo."),
    discount: z.number().min(0).optional().describe("Descuento aplicado (opcional)."),
  }),
  async execute(input, ctx) {
    const tenant = getTenant(ctx);
    const result = await prepareOrder(tenant, input);
    if (!result.ok) {
      return {
        ok: false,
        needsAddress: result.needsAddress ?? false,
        unavailable: result.unavailable,
        message: result.message,
      };
    }
    return {
      ok: true,
      customer: result.customer,
      deliveryAddress: result.deliveryAddress,
      paymentMethod: result.paymentMethod,
      summary: result.summary,
      note:
        "Muestra este resumen al cliente (incluye el envio). Antes de confirm_order, " +
        "pregunta la forma de pago (efectivo o transferencia) si aun no la sabes.",
    };
  },
});
