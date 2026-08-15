import { defineEval } from "eve/evals";

/**
 * Marcas coloquiales y "N litros de X" (conversaciones reales): "fabuloso" es un
 * TIPO de producto — el agente debe confirmar tipo/presentacion con equivalentes
 * del catalogo, no asumir el primer resultado. "20 litros de cloro" debe
 * proponer el bidon de 20 L, no 20 unidades.
 */
export default defineEval({
  description:
    "Ante 'fabuloso del amarillo' confirma tipo/presentacion sin asumir; '20 litros de cloro' propone el bidon de 20L.",
  async test(t) {
    await t.send("Hola, ¿me mandas un fabuloso del amarillo?");
    t.notCalledTool("confirm_order");
    t.notCalledTool("create_order");
    await t.send("Mejor mandame 20 litros de cloro");
    t.succeeded();
    t.calledTool("search_products");
    t.judge.autoevals
      .closedQA(
        "En la conversacion: (1) ante 'fabuloso del amarillo' el agente NO da por " +
          "hecho un producto — pregunta que tipo de producto o aroma busca, u ofrece " +
          "opciones reales del catalogo aclarando cual es cual, sin fingir que vende " +
          "la marca Fabuloso ni armar el pedido de inmediato; (2) ante '20 litros de " +
          "cloro' ofrece la presentacion de 20 litros (bidon/porron) con su precio " +
          "real, no 20 unidades de 1 litro.",
      )
      .atLeast(0.6);
  },
});
