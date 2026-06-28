import { defineTool } from "eve/tools";
import { z } from "zod";
import { getTenant } from "../lib/tenant.js";
import { searchProducts } from "../lib/ops/products.js";

/**
 * Busca productos del catalogo real de la organizacion. Es el primer paso
 * obligatorio del flujo de pedido: nunca inventes productos ni precios.
 */
export default defineTool({
  description:
    "Busca productos en el catalogo de la organizacion por nombre, descripcion o " +
    "SKU. Devuelve nombre, precio, unidad y disponibilidad. USALA SIEMPRE antes " +
    "de armar un pedido o dar precios; no inventes productos ni precios.",
  inputSchema: z.object({
    query: z.string().min(1).describe("Texto a buscar (nombre o tipo de producto)."),
    limit: z.number().int().min(1).max(25).optional().describe("Maximo de resultados (default 8)."),
  }),
  async execute({ query, limit }, ctx) {
    const tenant = getTenant(ctx);
    const products = await searchProducts(tenant, query, { limit });
    return {
      ok: true,
      count: products.length,
      products: products.map((p) => ({
        id: p.id,
        name: p.name,
        sku: p.sku,
        unit: p.unit,
        price: p.price,
        wholesalePrice: p.wholesalePrice,
        available: p.isAvailable && p.stock > 0,
      })),
      note:
        products.length === 0
          ? "Sin coincidencias. Sugiere al cliente describir el producto de otra forma."
          : undefined,
    };
  },
});
