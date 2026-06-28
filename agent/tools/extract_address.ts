import { defineTool } from "eve/tools";
import { z } from "zod";
import { getTenant } from "../lib/tenant.js";
import { saveCustomerLocation } from "../lib/ops/customer-locations.js";

/** Alias de save_customer_location para compatibilidad con prompts existentes. */
export default defineTool({
  description:
    "Guarda la direccion de entrega del cliente. Equivalente a save_customer_location: " +
    "acepta calle/colonia/ciudad, referencias, URL de Google Maps o coordenadas.",
  inputSchema: z.object({
    street: z.string().optional().describe("Calle y numero."),
    colony: z.string().optional().describe("Colonia."),
    postalCode: z.string().optional().describe("Codigo postal."),
    city: z.string().optional().describe("Ciudad/municipio."),
    zone: z.string().optional().describe("Zona o sector."),
    reference: z.string().optional().describe("Referencias para ubicar."),
    googleMapsUrl: z.string().optional().describe("URL de Google Maps."),
    latitude: z.number().optional(),
    longitude: z.number().optional(),
    contactName: z.string().optional().describe("Nombre del cliente si lo proporciona."),
  }),
  async execute(input, ctx) {
    const tenant = getTenant(ctx);
    const result = await saveCustomerLocation(tenant, input);
    if (!result.ok || !result.location) {
      return { ok: false, message: result.message };
    }
    return {
      ok: true,
      address: result.location.formattedAddress,
      locationId: result.location.id,
      note: "Confirma esta direccion con el cliente antes de crear el pedido.",
    };
  },
});
