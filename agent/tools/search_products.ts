import { defineTool } from "eve/tools";
import { z } from "zod";
import { getTenant } from "../lib/tenant.js";
import { searchProducts } from "../lib/ops/products.js";

interface PresentationEntry {
  id: string;
  name: string;
  presentation: string | null;
  sku: string | null;
  unit: string;
  price: number;
  wholesalePrice: number | null;
  available: boolean;
  description?: string | null;
}

interface ProductLine {
  line: string;
  description: string | null;
  presentations: PresentationEntry[];
}

/**
 * Busca productos del catalogo real de la organizacion. Es el primer paso
 * obligatorio del flujo de pedido: nunca inventes productos ni precios.
 */
export default defineTool({
  description:
    "Busca productos en el catalogo de la organizacion por palabras clave " +
    "(nombre, descripcion o SKU); no hace falta la frase exacta, tolera " +
    "acentos y plurales (p. ej. 'detergente ropa color'). Devuelve lineas de " +
    "producto agrupadas, cada una con sus presentaciones (1L, 4L...) con id, " +
    "precio, unidad y disponibilidad; para prepare_order usa el `id` de la " +
    "presentacion concreta que elija el cliente. USALA SIEMPRE antes de armar " +
    "un pedido o dar precios; no inventes productos, precios ni para que " +
    "sirve un producto: si vas a decir para que sirve o a que producto se " +
    "parece, basate SOLO en el campo `description` devuelto (si viene null, " +
    "no lo inventes ni lo asumas por el nombre).",
  inputSchema: z.object({
    query: z.string().min(1).describe("Palabras clave del producto (nombre o tipo)."),
    limit: z.number().int().min(1).max(25).optional().describe("Maximo de resultados (default 8)."),
  }),
  async execute({ query, limit }, ctx) {
    const tenant = getTenant(ctx);
    const products = await searchProducts(tenant, query, { limit, diversify: true });

    const lines: ProductLine[] = [];
    const byGroup = new Map<string, ProductLine>();
    for (const p of products) {
      let line = byGroup.get(p.groupKey);
      if (!line) {
        line = { line: p.groupKey, description: p.description, presentations: [] };
        byGroup.set(p.groupKey, line);
        lines.push(line);
      }
      const entry: PresentationEntry = {
        id: p.id,
        name: p.name,
        presentation: p.presentation,
        sku: p.sku,
        unit: p.unit,
        price: p.price,
        wholesalePrice: p.wholesalePrice,
        available: p.isAvailable && p.stock > 0,
      };
      // description por presentacion solo cuando difiere de la de la linea.
      if (p.description !== line.description) entry.description = p.description;
      line.presentations.push(entry);
    }

    return {
      ok: true,
      count: products.length,
      lines,
      note:
        products.length === 0
          ? "Sin coincidencias. Sugiere al cliente describir el producto de otra forma."
          : undefined,
    };
  },
});
