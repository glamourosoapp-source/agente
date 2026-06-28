import { defineTool } from "eve/tools";
import { z } from "zod";
import { getTenant } from "../lib/tenant.js";
import { getPendingDocuments } from "../lib/ops/documents.js";

/**
 * Lista los documentos pendientes de revision de la organizacion.
 */
export default defineTool({
  description:
    "Lista los documentos pendientes de revision de la organizacion (comprobantes, " +
    "ordenes de compra, facturas). Util para dar seguimiento a documentos que el " +
    "equipo aun no valida.",
  inputSchema: z.object({
    limit: z.number().int().min(1).max(50).optional().describe("Maximo de resultados (default 10)."),
  }),
  async execute({ limit }, ctx) {
    const tenant = getTenant(ctx);
    const documents = await getPendingDocuments(tenant, limit);
    return { ok: true, count: documents.length, documents };
  },
});
