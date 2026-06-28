import { defineTool } from "eve/tools";
import { z } from "zod";
import { getTenant } from "../lib/tenant.js";
import { checkProductAvailability } from "../lib/ops/products.js";

/**
 * Verifica disponibilidad/stock de un producto por id o por nombre.
 */
export default defineTool({
  description:
    "Verifica si un producto esta disponible y con stock, por id (preferido) o " +
    "por nombre. Usala antes de confirmar un pedido si dudas de la existencia.",
  inputSchema: z.object({
    productId: z.string().optional().describe("Id del producto (preferido)."),
    name: z.string().optional().describe("Nombre del producto si no tienes el id."),
  }),
  async execute({ productId, name }, ctx) {
    const tenant = getTenant(ctx);
    if (!productId && !name) {
      return { ok: false, message: "Indica productId o name." };
    }
    const result = await checkProductAvailability(tenant, { productId, name });
    if (!result.found) {
      return { ok: true, found: false, message: "No encontre ese producto en el catalogo." };
    }
    return {
      ok: true,
      found: true,
      product: {
        id: result.product.id,
        name: result.product.name,
        unit: result.product.unit,
        price: result.product.price,
      },
      available: result.available,
      stock: result.stock,
    };
  },
});
