/**
 * Politica de pago del agente.
 *
 * El agente solo cierra pedidos de contado (efectivo). Todo lo que implique
 * transferencia (datos bancarios, validacion del comprobante, credito) o
 * facturacion fiscal lo resuelve una persona del equipo: el agente avisa al
 * cliente, deriva con `handoff_to_human` y NO crea el pedido.
 */

/** Formas de pago que el agente no puede cerrar solo. */
export const HUMAN_ONLY_PAYMENT_METHODS = ["transferencia"] as const;

/** Motivo de derivacion para pagos por transferencia. */
export const TRANSFER_HANDOFF_REASON = "payment_transfer";

/** Motivo de derivacion para peticiones de factura. */
export const INVOICE_HANDOFF_REASON = "invoice_request";

/** True si esa forma de pago obliga a derivar con una persona. */
export function requiresHumanPayment(paymentMethod?: string | null): boolean {
  if (!paymentMethod) return false;
  return (HUMAN_ONLY_PAYMENT_METHODS as readonly string[]).includes(
    paymentMethod.trim().toLowerCase(),
  );
}

/**
 * Instruccion que se le devuelve al modelo cuando intenta cerrar un pedido por
 * transferencia. Se usa igual en confirm_order, create_order y
 * convert_quote_to_order.
 */
export const TRANSFER_HANDOFF_MESSAGE =
  "Los pagos por transferencia los cierra una persona del equipo (datos bancarios y " +
  "validacion del comprobante). NO crees el pedido: avisa al cliente que lo conectas " +
  "con una persona y llama handoff_to_human con reason 'payment_transfer', incluyendo " +
  "en el summary los productos, cantidades, total y direccion que ya tengas.";

/** Aviso que acompana al resumen de prepare_order cuando el pago es transferencia. */
export const TRANSFER_PREPARE_NOTICE =
  "El cliente quiere pagar por transferencia: NO llames confirm_order. Avisa que lo " +
  "conectas con una persona y deriva con handoff_to_human (reason 'payment_transfer'), " +
  "pasando este resumen en el summary.";
