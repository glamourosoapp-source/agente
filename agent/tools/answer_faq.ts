import { defineTool } from "eve/tools";
import { z } from "zod";
import { getTenant } from "../lib/tenant.js";
import { answerFaq } from "../lib/ops/faq.js";

/**
 * Responde preguntas frecuentes del negocio buscando en las FAQs reales de la
 * organizacion (busqueda semantica + heuristica). No inventes datos del negocio.
 */
export default defineTool({
  description:
    "Responde preguntas frecuentes del negocio (horarios, formas de pago, envios, " +
    "cobertura, politicas, etc.) buscando en las FAQs reales de la organizacion. " +
    "USALA SIEMPRE antes de responder datos del negocio; no inventes.",
  inputSchema: z.object({
    question: z.string().min(2).describe("Pregunta del cliente, tal cual."),
  }),
  async execute({ question }, ctx) {
    const tenant = getTenant(ctx);
    const result = await answerFaq(tenant, question);
    if (result.kind === "direct") {
      return { ok: true, kind: "direct", answer: result.answer, confidence: result.score };
    }
    return {
      ok: true,
      kind: "candidates",
      candidates: result.candidates,
      note:
        result.candidates.length === 0
          ? "No hay FAQ relacionada; si no sabes la respuesta con certeza, ofrece derivar a una persona."
          : "Usa estas FAQs para redactar; si ninguna aplica, dilo con honestidad.",
    };
  },
});
