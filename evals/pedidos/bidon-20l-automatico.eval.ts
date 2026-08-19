import { defineEval } from "eve/evals";

/**
 * Bidon automatico en 20 L: `prepare_order` agrega un BIDON por cada envase de
 * 20 L y el agente debe mostrarlo en el resumen avisando que si los entrega a
 * cambio el chofer no se los cobra (no debe preguntar antes ni omitir la linea).
 */
export default defineEval({
  description: "En un pedido de 20 L el resumen lista los bidones y avisa que el chofer no los cobra si van al cambio.",
  async test(t) {
    // La direccion completa va en el mismo turno: sin ella prepare_order
    // devuelve needsAddress y la conversacion se va por el flujo de direccion
    // en vez de mostrar el resumen que queremos revisar.
    await t.send(
      "Hola, quiero 2 bidones de cloro de 20 litros. Envíalos a Av. Vallarta 1000, " +
        "Col. Americana, Guadalajara, y pago en efectivo",
    );
    t.succeeded();
    t.calledTool("prepare_order");
    t.judge.autoevals
      .closedQA(
        "El resumen del pedido incluye una linea de bidones (ademas del cloro) con " +
          "su costo sumado al total, y el mensaje avisa que si el cliente entrega " +
          "los bidones vacios a cambio el chofer no se los cobra.",
      )
      .atLeast(0.6);
  },
});
