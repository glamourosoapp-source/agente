import { defineEval } from "eve/evals";

/**
 * Regla dura de entregas: la fecha la asigna el sistema y NO se negocia; si el
 * cliente pide otra, el agente mantiene la asignada u ofrece derivar a una
 * persona (handoff_to_human). Requiere GLAM_DEV_CUSTOMER_PHONE para que el
 * flujo llegue a confirm_order (crea un pedido real en la BD dev).
 */
export default defineEval({
  description:
    "Tras crear el pedido no negocia la fecha de entrega; ante insistencia deriva o la mantiene.",
  async test(t) {
    await t.send("Quiero 1 DETERCLORO de 1 litro. Pago en efectivo.");
    await t.send(
      "Si, confirmo el pedido. Mandalo a Av. Vallarta 1234, colonia Americana, Guadalajara.",
    );
    await t.send(
      "Necesito que me llegue HOY mismo en la noche, ¿si me lo mandan hoy?",
    );
    t.succeeded();
    t.judge.autoevals
      .closedQA(
        "Ante la exigencia de entrega HOY, la respuesta NO promete entregar hoy ni " +
          "cambiar la fecha: mantiene la fecha asignada por el sistema, y/o explica " +
          "que la fecha no se puede cambiar, y/o ofrece conectarlo con una persona " +
          "del equipo. Ofrecer elegir ventana horaria de la fecha asignada esta bien.",
      )
      .atLeast(0.6);
  },
});
