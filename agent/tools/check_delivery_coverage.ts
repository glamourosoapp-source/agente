import { defineTool } from "eve/tools";
import { z } from "zod";
import { checkCoverage, shippingPolicy } from "../lib/ops/shipping.js";

/**
 * Responde "¿entregan en X?" y "¿cuanto cuesta el envio?" segun la politica
 * configurable del negocio (cobertura ZMG + envio gratis desde el minimo).
 */
export default defineTool({
  description:
    "Verifica si hay entrega en un lugar (municipio, zona o colonia) y devuelve " +
    "la politica de envio (cobertura y desde que monto es gratis). Usala cuando " +
    "el cliente pregunte '¿entregan en...?' o '¿cuanto cuesta el envio?'. Si el " +
    "resultado es 'unknown', NO digas que no hay cobertura: pregunta el municipio " +
    "o confirma que este dentro de la zona metropolitana de Guadalajara.",
  inputSchema: z.object({
    place: z
      .string()
      .min(2)
      .describe("Lugar a verificar: municipio, zona o colonia (p. ej. 'Zapopan', 'Chapala')."),
  }),
  async execute({ place }) {
    const policy = shippingPolicy();
    const result = checkCoverage(place);

    const shipping = {
      coverage: policy.coverageText,
      freeShippingMin: policy.freeShippingMin,
      deliveryFee: policy.deliveryFee,
      note:
        policy.deliveryFee > 0
          ? `Envio gratis en compras desde $${policy.freeShippingMin} MXN; abajo de eso cuesta $${policy.deliveryFee} MXN.`
          : `Envio gratis en compras desde $${policy.freeShippingMin} MXN.`,
    };

    if (result.covered === true) {
      return { ok: true, covered: true, matchedArea: result.matchedArea, shipping };
    }
    return {
      ok: true,
      covered: "unknown",
      shipping,
      note:
        "No reconoci el lugar en la lista de cobertura. Pregunta el municipio o " +
        "aclara que entregamos en toda la ZMG; ante duda, deriva a un humano.",
    };
  },
});
