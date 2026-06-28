import { defineTool } from "eve/tools";
import { z } from "zod";
import { getTenant } from "../lib/tenant.js";
import { findCustomerByPhone } from "../lib/ops/customers.js";
import { listCustomerLocations } from "../lib/ops/customer-locations.js";

/**
 * Lista las ubicaciones guardadas del cliente para que elija una al pedir.
 */
export default defineTool({
  description:
    "Lista las ubicaciones de entrega guardadas del cliente actual. Usala para " +
    "ofrecerle sus direcciones registradas y que elija una antes de crear el pedido.",
  inputSchema: z.object({}),
  async execute(_input, ctx) {
    const tenant = getTenant(ctx);
    if (!tenant.customerPhone) {
      return { ok: false, message: "No tengo el telefono del cliente en este turno." };
    }
    const customer = await findCustomerByPhone(tenant, tenant.customerPhone);
    if (!customer) {
      return { ok: true, found: false, locations: [], message: "Cliente sin ubicaciones guardadas." };
    }
    const locations = await listCustomerLocations(tenant, customer.id);
    return {
      ok: true,
      found: locations.length > 0,
      locations: locations.map((location, index) => ({
        index: index + 1,
        id: location.id,
        label: location.label,
        formattedAddress: location.formattedAddress,
        googleMapsUrl: location.googleMapsUrl,
        isDefault: location.isDefault,
      })),
    };
  },
});
