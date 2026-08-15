import { defineEval } from "eve/evals";

/**
 * Flujo canonico: con la pura intencion de compra (sin "si" explicito) el agente
 * NO debe crear el pedido; debe mostrar resumen/precio real y pedir confirmacion
 * o los datos que falten (direccion, forma de pago).
 */
export default defineEval({
  description:
    "Con intencion de compra pero sin confirmacion explicita no llama confirm_order/create_order.",
  async test(t) {
    await t.send("Quiero 2 de DETERCLORO de 1 litro por favor");
    t.succeeded();
    t.calledTool("search_products");
    t.notCalledTool("confirm_order");
    t.notCalledTool("create_order");
    t.judge.autoevals
      .closedQA(
        "La respuesta usa datos reales del catalogo (menciona DETERCLORO y/o su " +
          "precio) y avanza el pedido SIN darlo por creado: pide confirmacion, " +
          "direccion de entrega o forma de pago. No dice que el pedido ya quedo " +
          "registrado ni da numero de pedido.",
      )
      .atLeast(0.6);
  },
});
