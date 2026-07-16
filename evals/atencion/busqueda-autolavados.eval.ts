import { defineEval } from "eve/evals";

/**
 * Regresion del caso autolavados: ante "productos para autolavados", el agente
 * debe mencionar lineas liquidas automotrices (Almorol Crema/Liquido, champu auto)
 * ademas de cera y esponjas, sin esperar a que el cliente pida "crema almorol".
 */
export default defineEval({
  description:
    "Ante 'productos para autolavados' ofrece liquidos automotrices ademas de cera/esponjas.",
  async test(t) {
    await t.send("Que productos tienes para autolavados");
    t.succeeded();
    t.calledTool("search_products");
    t.judge.autoevals
      .closedQA(
        "La respuesta menciona productos reales del catalogo para autolavado o " +
          "automotriz. Debe incluir al menos una linea LIQUIDA relevante " +
          "(p. ej. Almorol Crema, Almorol Liquido, SH Alta Espuma o SH Con Cera) " +
          "con precio o presentacion, ademas de otros tipos como cera o esponjas. " +
          "No responde que no hay productos ni se limita unicamente a esponjas " +
          "sin mencionar liquidos/champus si existen en el catalogo.",
      )
      .atLeast(0.6);
  },
});
