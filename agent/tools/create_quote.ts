import { defineTool } from "eve/tools";
import { z } from "zod";
import { getTenant } from "../lib/tenant.js";
import { createQuote } from "../lib/ops/quotes.js";

const itemSchema = z.object({
  productId: z.string().optional(),
  name: z.string().optional(),
  quantity: z.number().positive(),
  notes: z.string().optional(),
});

/**
 * Crea una cotizacion (presupuesto informativo, sin compromiso de compra ni
 * direccion). Util cuando el cliente pide precios para varios productos.
 */
export default defineTool({
  description:
    "Crea una cotizacion (presupuesto) para el cliente con los productos y " +
    "cantidades indicados. No requiere direccion. Devuelve el numero de " +
    "cotizacion (COT-...) y la vigencia. Luego puedes convertirla en pedido con " +
    "convert_quote_to_order.",
  inputSchema: z.object({
    items: z.array(itemSchema).min(1).describe("Productos a cotizar."),
    contactName: z.string().optional(),
    taxRate: z.number().min(0).max(100).optional().describe("Tasa de impuesto % (opcional)."),
    validDays: z.number().int().min(1).max(60).optional().describe("Dias de vigencia (default 7)."),
    notes: z.string().optional(),
  }),
  async execute(input, ctx) {
    const tenant = getTenant(ctx);
    const result = await createQuote(tenant, input);
    if (!result.ok) return { ok: false, message: result.message };
    return { ok: true, quote: result.quote, note: "Comparte el numero de cotizacion y el total con el cliente." };
  },
});
