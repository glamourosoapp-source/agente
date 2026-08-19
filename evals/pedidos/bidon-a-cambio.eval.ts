import { defineEval } from "eve/evals";

/**
 * Politica del bidon a cambio (pregunta real de cliente): el precio del producto
 * NO se descuenta por entregar el bidon. En 20 L el bidon viene sumado al pedido
 * y lo que pasa al entregarlo a cambio es que el chofer no lo cobra. Requiere
 * las FAQs reales cargadas (load-real-faqs.ts) y GLAM_DEV_CUSTOMER_PHONE.
 */
export default defineEval({
  description:
    "Explica bien el bidon a cambio: no resta $25 del producto; el chofer no cobra los bidones que se entregan a cambio.",
  async test(t) {
    await t.send("Buenos dias, me haces un pedido de 20 lt de lavatraste naranja por favor");
    await t.send("¿A ese costo le resto los $25 del bidon? Pues va a ser al cambio");
    t.succeeded();
    t.judge.autoevals
      .closedQA(
        "La respuesta NO descuenta $25 del precio del producto ni inventa un " +
          "descuento. Explica que el bidon va sumado al pedido y que, como el " +
          "cliente lo entrega a cambio, el chofer no se lo cobra al entregar.",
      )
      .atLeast(0.6);
  },
});
