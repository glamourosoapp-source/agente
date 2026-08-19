import { defineTool } from "eve/tools";
import { z } from "zod";
import { getTenant } from "../lib/tenant.js";
import { prepareOrder } from "../lib/ops/orders.js";
import { bidonNotice } from "../lib/ops/bidon.js";
import { requiresHumanPayment, TRANSFER_PREPARE_NOTICE } from "../lib/payment-policy.js";

const itemSchema = z.object({
  productId: z.string().optional().describe("Id del producto (preferido, de search_products)."),
  name: z.string().optional().describe("Nombre del producto si no tienes el id."),
  quantity: z
    .number()
    .int()
    .positive()
    .max(500)
    .describe("Cantidad solicitada (entera; pedidos mayores a 500 van con un humano)."),
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
    "unavailable: avisa al cliente y ofrece alternativas. Si summary.unresolved " +
    "trae items, esos NO quedaron en el pedido (no se encontraron o hay que " +
    "aclarar presentacion/cantidad): dilo al cliente SIEMPRE antes de seguir; " +
    "no confirmes un pedido incompleto en silencio. El costo de envio se " +
    "calcula solo (gratis desde el minimo del negocio) y no puedes aplicar " +
    "descuentos (eso lo autoriza una persona del equipo). Si el cliente quiere " +
    "pagar por transferencia devuelve requiresHuman: arma el resumen igual, pero " +
    "NO confirmes el pedido, deriva con handoff_to_human. Si el pedido lleva " +
    "envases de 20 L, el resumen ya incluye un BIDON por cada uno " +
    "(summary.bidones): menciona cuantos son y avisa que si los entrega a " +
    "cambio el chofer no se los cobra. Muestra el resumen al cliente y pide su " +
    "confirmacion explicita.",
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
      .describe(
        "Forma de pago si el cliente ya la indico. Con 'transferencia' el pedido " +
          "no lo cierras tu: se deriva a una persona.",
      ),
    // Sin deliveryFee ni discount: el envio lo calcula la politica del negocio
    // y los descuentos solo los autoriza una persona del equipo (handoff).
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
    // El resumen se devuelve igual aunque el pago sea por transferencia: sirve
    // como brief para la persona que retome la conversacion.
    const transferHandoff = requiresHumanPayment(result.paymentMethod);
    return {
      ok: true,
      requiresHuman: transferHandoff,
      customer: result.customer,
      deliveryAddress: result.deliveryAddress,
      paymentMethod: result.paymentMethod,
      summary: result.summary,
      note:
        (transferHandoff
          ? `Muestra este resumen al cliente (incluye el envio). ${TRANSFER_PREPARE_NOTICE}`
          : "Muestra este resumen al cliente (incluye el envio) y pide su confirmacion " +
            "explicita; el pago es en efectivo.") +
        (bidonNotice(result.summary?.bidones ?? null)
          ? ` ${bidonNotice(result.summary?.bidones ?? null)}`
          : ""),
    };
  },
});
