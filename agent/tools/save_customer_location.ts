import { defineTool } from "eve/tools";
import { z } from "zod";
import { getTenant } from "../lib/tenant.js";
import { saveCustomerLocation } from "../lib/ops/customer-locations.js";

/**
 * Guarda una ubicacion de entrega del cliente (texto, pin de WhatsApp o link de Maps).
 */
export default defineTool({
  description:
    "Guarda una ubicacion de entrega del cliente. Acepta calle/colonia/ciudad, " +
    "referencias, URL de Google Maps y/o coordenadas del pin de WhatsApp. Maximo 3 " +
    "ubicaciones por cliente. Devuelve la direccion formateada para confirmarla.",
  inputSchema: z.object({
    label: z.string().optional().describe("Etiqueta: Casa, Local, Bodega, etc."),
    street: z.string().optional().describe("Calle y numero."),
    colony: z.string().optional().describe("Colonia."),
    postalCode: z.string().optional().describe("Codigo postal."),
    city: z.string().optional().describe("Ciudad/municipio."),
    zone: z.string().optional().describe("Zona o sector."),
    reference: z.string().optional().describe("Referencias para ubicar."),
    googleMapsUrl: z.string().optional().describe("URL de Google Maps compartida por el cliente."),
    latitude: z.number().optional().describe("Latitud del pin de ubicacion de WhatsApp."),
    longitude: z.number().optional().describe("Longitud del pin de ubicacion de WhatsApp."),
    isDefault: z.boolean().optional().describe("Marcar como ubicacion predeterminada."),
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
      location: {
        id: result.location.id,
        label: result.location.label,
        formattedAddress: result.location.formattedAddress,
        googleMapsUrl: result.location.googleMapsUrl,
        isDefault: result.location.isDefault,
      },
      note: "Confirma esta direccion con el cliente antes de crear el pedido.",
    };
  },
});
