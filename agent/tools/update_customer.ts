import { defineTool } from "eve/tools";
import { z } from "zod";
import { getTenant } from "../lib/tenant.js";
import { findOrCreateCustomerByPhone, updateCustomer } from "../lib/ops/customers.js";

/**
 * Actualiza los datos del cliente actual (nombre, email). Para la direccion usa
 * extract_address. Crea el cliente si aun no existe.
 */
export default defineTool({
  description:
    "Actualiza los datos del cliente actual: nombre y/o email. Usala cuando el " +
    "cliente se presenta ('soy Ana', 'mi correo es...') o corrige sus datos. " +
    "Para la direccion de entrega usa extract_address, no esta tool.",
  inputSchema: z.object({
    name: z.string().min(1).optional().describe("Nombre del cliente."),
    email: z.string().email().optional().describe("Correo electronico del cliente."),
  }),
  async execute({ name, email }, ctx) {
    const tenant = getTenant(ctx);
    if (!tenant.customerPhone) {
      return { ok: false, message: "No tengo el telefono del cliente para actualizar sus datos." };
    }
    if (name === undefined && email === undefined) {
      return { ok: false, message: "No diste ningun dato (nombre o email) para actualizar." };
    }

    const customer = await findOrCreateCustomerByPhone(tenant, {
      phone: tenant.customerPhone,
      name,
    });
    const updated = await updateCustomer(tenant, customer.id, { name, email });
    if (!updated) {
      return { ok: false, message: "No pude actualizar los datos del cliente." };
    }
    return {
      ok: true,
      customer: { name: updated.name, email: updated.email, phone: updated.phone },
      message: "Datos del cliente actualizados.",
    };
  },
});
