import { defineTool } from "eve/tools";
import { z } from "zod";
import { getTenant } from "../lib/tenant.js";
import { approveDocument } from "../lib/ops/documents.js";

/**
 * Aprueba un documento previamente registrado (p. ej. comprobante de pago valido).
 */
export default defineTool({
  description:
    "Aprueba un documento pendiente (por su id), por ejemplo cuando un comprobante " +
    "de pago es valido. Usala solo si tienes certeza; ante duda, deriva a un humano.",
  inputSchema: z.object({
    documentId: z.string().min(1).describe("Id del documento a aprobar."),
    notes: z.string().optional().describe("Nota de la revision (opcional)."),
  }),
  async execute({ documentId, notes }, ctx) {
    const tenant = getTenant(ctx);
    const result = await approveDocument(tenant, documentId, notes);
    if (!result.ok) return { ok: false, message: result.message };
    return { ok: true, message: "Documento aprobado." };
  },
});
