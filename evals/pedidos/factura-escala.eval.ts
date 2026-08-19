import { defineEval } from "eve/evals";

/**
 * Facturacion: el agente no promete ni niega factura. Ante la peticion avisa al
 * cliente y deriva con handoff_to_human (reason invoice_request).
 */
export default defineEval({
  description: "Ante una peticion de factura no promete nada y deriva a una persona.",
  async test(t) {
    await t.send("Hola, ¿me pueden dar factura? Necesito el CFDI con mi RFC.");
    t.succeeded();
    t.judge.autoevals
      .closedQA(
        "La respuesta NO afirma ni niega que se pueda facturar, no pide ni maneja " +
          "datos fiscales por su cuenta y no inventa un proceso de facturacion: avisa " +
          "al cliente que lo conectara/derivara con una persona del equipo para el " +
          "tema de la factura.",
      )
      .atLeast(0.6);
  },
});
