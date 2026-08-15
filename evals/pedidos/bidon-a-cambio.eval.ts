import { defineEval } from "eve/evals";

/**
 * Politica del bidon a cambio (pregunta real de cliente): el precio de 10/20 L
 * ya es con intercambio de bidon — NO se resta nada por entregarlo; los $25 del
 * bidon solo se cobran cuando el cliente NO entrega uno. Requiere las FAQs
 * reales cargadas (load-real-faqs.ts) y GLAM_DEV_CUSTOMER_PHONE.
 */
export default defineEval({
  description:
    "Explica bien el bidon a cambio: no resta $25 por entregarlo; solo se cobra si no hay intercambio.",
  async test(t) {
    await t.send("Buenos dias, me haces un pedido de 20 lt de lavatraste naranja por favor");
    await t.send("¿A ese costo le resto los $25 del bidon? Pues va a ser al cambio");
    t.succeeded();
    t.judge.autoevals
      .closedQA(
        "La respuesta deja claro que el precio cotizado ya es CON bidon a cambio y " +
          "que NO se resta ningun monto por entregar el bidon; el cargo de $25 del " +
          "bidon aplica solo cuando el cliente NO entrega un bidon vacio a cambio. " +
          "No promete restar $25 ni inventa un descuento.",
      )
      .atLeast(0.6);
  },
});
