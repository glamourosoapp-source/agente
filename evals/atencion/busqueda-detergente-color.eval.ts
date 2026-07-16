import { defineEval } from "eve/evals";

/**
 * Regresion del caso "MAX COLOR": ante "detergente para ropa de color", la
 * busqueda literal antigua no encontraba el producto (la frase no coincide con
 * la descripcion "prendas de colores" y el limite de 8 se llenaba de otras
 * lineas alfabeticamente primeras). Con busqueda por tokens + ranking, el
 * agente debe ofrecer el producto correcto en vez de decir que no hay.
 */
export default defineEval({
  description: "Ante 'detergente para ropa de color' encuentra el producto para prendas de colores.",
  async test(t) {
    await t.send("Hola, ¿tienes detergente para ropa de color?");
    t.succeeded();
    t.calledTool("search_products");
    t.judge.autoevals
      .closedQA(
        "La respuesta ofrece al menos un producto cuya descripcion corresponde a " +
          "ropa o prendas de colores (p. ej. MAX COLOR), con nombre y precio " +
          "reales del catalogo, y NO responde que no hay coincidencias ni ofrece " +
          "unicamente productos para ropa blanca o de otro uso.",
      )
      .atLeast(0.6);
  },
});
