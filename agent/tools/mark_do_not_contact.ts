import { defineTool } from "eve/tools";
import { z } from "zod";
import { getTenant } from "../lib/tenant.js";
import { recordOptOut } from "../lib/bridge.js";

/**
 * Registra al cliente actual en la lista de exclusión ("no contactar") del CRM.
 * Complementa la detección determinista del canal: esta tool es para cuando el
 * MODELO interpreta que la persona no quiere volver a ser contactada aunque no
 * use las frases exactas ("prefiero que no me busquen", "esto es spam", etc.).
 */
export default defineTool({
  description:
    "Marca al cliente actual como NO CONTACTAR: nunca más recibirá mensajes " +
    "de prospección o campañas. Úsala cuando pida explícitamente que dejemos " +
    "de escribirle o se queje de recibir spam. NO la uses por un simple " +
    "'no me interesa' o 'ahorita no' (eso es una objeción, no un opt-out).",
  inputSchema: z.object({
    motivo: z
      .string()
      .max(200)
      .describe("Frase del cliente que motiva la exclusión, para auditoría."),
  }),
  async execute(input, ctx) {
    const tenant = getTenant(ctx);
    if (!tenant.customerPhone) {
      return { ok: false, message: "No tengo el teléfono del cliente en este turno." };
    }
    const result = await recordOptOut(tenant.organizationId, tenant.customerPhone, input.motivo);
    if (!result?.ok) {
      return {
        ok: false,
        message: "No pude registrar la exclusión ahora; despídete cortésmente igual.",
      };
    }
    return {
      ok: true,
      message:
        "Exclusión registrada: no volverá a recibir mensajes fríos. Despídete brevemente y no insistas.",
    };
  },
});
