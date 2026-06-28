import { defineTool } from "eve/tools";
import { z } from "zod";
import { getTenant } from "../lib/tenant.js";
import { findProspectByPhone } from "../lib/ops/prospects.js";

/**
 * Identifica si el numero que escribe corresponde a un prospecto en campaña de
 * prospeccion, devolviendo su negocio/ciudad/estado para personalizar el mensaje.
 */
export default defineTool({
  description:
    "Identifica si el cliente actual es un prospecto de una campaña (por su " +
    "telefono). Devuelve su negocio, ciudad y estado del contacto para que " +
    "personalices la presentacion. Util en el subagente de prospeccion.",
  inputSchema: z.object({}),
  async execute(_input, ctx) {
    const tenant = getTenant(ctx);
    if (!tenant.customerPhone) {
      return { ok: false, message: "No tengo el telefono del cliente en este turno." };
    }
    const prospect = await findProspectByPhone(tenant, tenant.customerPhone);
    if (!prospect) {
      return { ok: true, found: false, message: "No es un prospecto registrado." };
    }
    return {
      ok: true,
      found: true,
      prospect: {
        id: prospect.id,
        name: prospect.name,
        businessType: prospect.businessType,
        city: prospect.city,
        status: prospect.status,
      },
    };
  },
});
