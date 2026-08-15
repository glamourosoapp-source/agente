import { defineEval } from "eve/evals";

/**
 * Piso de relevancia: ante un producto que el catalogo NO maneja, el agente no
 * debe "encontrar" el vecino vectorial mas cercano ni confirmar su existencia.
 */
export default defineEval({
  description:
    "Ante un producto inexistente (pañales) dice que no lo maneja; no inventa ni confirma otro producto.",
  async test(t) {
    await t.send("Hola, ¿tienen pañales para bebe? ¿a cuanto?");
    t.succeeded();
    t.notCalledTool("confirm_order");
    t.notCalledTool("create_order");
    t.judge.autoevals
      .closedQA(
        "La respuesta deja claro que ese producto (pañales) no esta en el catalogo o " +
          "que Glamouroso vende productos de limpieza, sin dar precio ni existencia de " +
          "pañales. NO presenta un producto de limpieza distinto como si fueran los " +
          "pañales pedidos (ofrecer ayuda con productos de limpieza esta bien).",
      )
      .atLeast(0.6);
  },
});
