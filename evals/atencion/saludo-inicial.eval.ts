import { defineEval } from "eve/evals";

/**
 * Primer contacto: el agente debe identificar al cliente con lookup_customer
 * ANTES de responder y presentarse en UN solo mensaje breve, sin listas
 * genericas de categorias inventadas ni mensajes de relleno tipo
 * "dejame ver quien eres".
 */
export default defineEval({
  description: "El saludo inicial identifica al cliente y se presenta en un solo mensaje breve.",
  async test(t) {
    await t.send("Hola");
    t.completed();
    t.calledTool("lookup_customer");
    t.judge.autoevals
      .closedQA(
        "La respuesta es un unico mensaje breve de bienvenida de Glamouroso " +
          "(productos de limpieza) que pregunta que necesita el cliente, sin " +
          "enumerar categorias inventadas, sin mencionar ropa u otros rubros " +
          "ajenos al negocio, y sin narrar pasos internos como 'dejame ver quien eres'.",
      )
      .atLeast(0.6);
  },
});
