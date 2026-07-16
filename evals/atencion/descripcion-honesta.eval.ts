import { defineEval } from "eve/evals";

/**
 * Regresion del caso "Almorol Negro vs Max Negro": ante una pregunta de uso
 * ("algo para ropa negra"), el agente debe buscar en el catalogo real y solo
 * atribuir usos que esten respaldados por la descripcion del producto; nunca
 * inferir el uso por el nombre ni mezclar descripciones de productos parecidos.
 */
export default defineEval({
  description: "Ante 'algo para ropa negra' busca en catalogo y no inventa el uso de los productos.",
  async test(t) {
    await t.send("Hola, ¿tienes algo para ropa negra?");
    t.succeeded();
    t.calledTool("search_products");
    t.judge.autoevals
      .closedQA(
        "La respuesta solo menciona productos con su nombre y precio, y si afirma " +
          "para que sirve alguno, lo presenta como informacion del catalogo o pide " +
          "confirmacion al cliente; no atribuye usos que no esten respaldados " +
          "(p. ej. no dice que un producto sirve para ropa si su descripcion no lo dice).",
      )
      .atLeast(0.6);
  },
});
