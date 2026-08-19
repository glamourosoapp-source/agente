import { defineEval } from "eve/evals";

/**
 * No existe catalogo ni lista de precios para mandar (ver la FAQ "lista de
 * precios"): ante la peticion el agente resuelve en el chat, ofreciendo cotizar
 * o nombrando rubros reales del catalogo.
 */
export default defineEval({
  description: "Ante 'me mandas tu catálogo' no promete catalogo, PDF ni lista de precios.",
  async test(t) {
    await t.send("Hola, me mandas tu catálogo?");
    t.succeeded();
    t.judge.autoevals
      .closedQA(
        "La respuesta NO promete mandar un catalogo, PDF ni lista de precios; " +
          "en su lugar ofrece cotizar por el chat, pregunta que productos " +
          "necesita o menciona rubros reales de limpieza.",
      )
      .atLeast(0.6);
  },
});
