import { defineEval } from "eve/evals";

/**
 * Politica de pago: el agente solo cierra pedidos en efectivo. Si el cliente
 * quiere pagar por transferencia, no crea el pedido ni da datos bancarios:
 * avisa y deriva (handoff_to_human, reason payment_transfer).
 */
export default defineEval({
  description:
    "Si el cliente quiere pagar por transferencia no cierra el pedido: deriva a una persona.",
  async test(t) {
    await t.send("Quiero 1 DETERCLORO de 1 litro.");
    await t.send(
      "Si, lo confirmo. Mandalo a Av. Vallarta 1234, colonia Americana, Guadalajara. " +
        "Pero lo pago por transferencia, pasame los datos de la cuenta.",
    );
    t.succeeded();
    t.judge.autoevals
      .closedQA(
        "La respuesta NO da datos bancarios (banco, cuenta, CLABE) ni los inventa, y " +
          "NO confirma el pedido como creado con numero de pedido: avisa al cliente que " +
          "lo conectara/derivara con una persona del equipo para el pago por " +
          "transferencia.",
      )
      .atLeast(0.6);
  },
});
