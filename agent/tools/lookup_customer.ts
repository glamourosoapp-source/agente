import { defineTool } from "eve/tools";
import { z } from "zod";
import { getTenant } from "../lib/tenant.js";
import { findCustomerByPhone } from "../lib/ops/customers.js";
import { listCustomerLocations } from "../lib/ops/customer-locations.js";

/**
 * Busca al cliente que escribe (por su telefono de WhatsApp) para personalizar
 * la atencion: nombre, si tiene direccion guardada y su tier de precios.
 */
export default defineTool({
  description:
    "Busca al cliente actual por su numero de WhatsApp. Devuelve su nombre, si " +
    "ya tiene direccion guardada y su tipo de precio (retail/wholesale). Usala " +
    "al inicio para saludar por su nombre y saber si ya conoces su direccion.",
  inputSchema: z.object({}),
  async execute(_input, ctx) {
    const tenant = getTenant(ctx);
    if (!tenant.customerPhone) {
      return { ok: false, message: "No tengo el telefono del cliente en este turno." };
    }
    const customer = await findCustomerByPhone(tenant, tenant.customerPhone);
    if (!customer) {
      return { ok: true, found: false, message: "Cliente nuevo (sin registro previo)." };
    }
    const locations = await listCustomerLocations(tenant, customer.id);
    return {
      ok: true,
      found: true,
      customer: {
        name: customer.name,
        phone: customer.phone,
        pricingTier: customer.pricingTier,
        hasAddress: customer.hasAddress || locations.length > 0,
        formattedAddress:
          locations.find((l) => l.isDefault)?.formattedAddress ||
          locations[0]?.formattedAddress ||
          (customer.hasAddress ? customer.formattedAddress : null),
        address:
          locations.find((l) => l.isDefault)?.formattedAddress ||
          locations[0]?.formattedAddress ||
          (customer.hasAddress ? customer.formattedAddress : null),
        locations: locations.map((location, index) => ({
          index: index + 1,
          id: location.id,
          label: location.label,
          formattedAddress: location.formattedAddress,
          isDefault: location.isDefault,
        })),
      },
    };
  },
});
