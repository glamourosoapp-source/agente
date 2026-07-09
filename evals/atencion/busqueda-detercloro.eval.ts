import { defineEval } from "eve/evals";

/**
 * Regresion DETERCLORO: ante consulta por detergente con cloro, el agente debe
 * ofrecer la linea DETERCLORO con descripcion real del catalogo.
 */
export default defineEval({
  description: "Ante 'detergente con cloro' encuentra DETERCLORO u equivalente con cloro.",
  async test(t) {
    await t.send("Hola, busco detergente con cloro para ropa");
    t.completed();
    t.calledTool("search_products");
    t.judge.autoevals
      .closedQA(
        "La respuesta ofrece al menos un producto relacionado con detergente con cloro " +
          "(p. ej. DETERCLORO) con nombre y precio del catalogo. No dice que no hay " +
          "coincidencias ni ofrece solo detergentes sin cloro como unica opcion.",
      )
      .atLeast(0.6);
  },
});
