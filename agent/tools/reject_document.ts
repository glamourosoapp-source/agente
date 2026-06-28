import { defineTool } from "eve/tools";
import { z } from "zod";
import { getTenant } from "../lib/tenant.js";
import { rejectDocument } from "../lib/ops/documents.js";

/**
 * Rechaza un documento previamente registrado, con un motivo.
 */
export default defineTool({
  description:
    "Rechaza un documento pendiente (por su id) con un motivo, por ejemplo cuando " +
    "un comprobante es ilegible o no corresponde. Explica al cliente que necesita " +
    "reenviarlo.",
  inputSchema: z.object({
    documentId: z.string().min(1).describe("Id del documento a rechazar."),
    notes: z.string().min(3).describe("Motivo del rechazo."),
  }),
  async execute({ documentId, notes }, ctx) {
    const tenant = getTenant(ctx);
    const result = await rejectDocument(tenant, documentId, notes);
    if (!result.ok) return { ok: false, message: result.message };
    return { ok: true, message: "Documento rechazado." };
  },
});
