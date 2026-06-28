import { defineTool } from "eve/tools";
import { z } from "zod";
import { getTenant } from "../lib/tenant.js";
import { registerDocument } from "../lib/ops/documents.js";

/**
 * Registra un documento enviado por el cliente (comprobante de pago, orden de
 * compra, factura) para revision humana. Lo deja en estado pending_review.
 */
export default defineTool({
  description:
    "Registra un documento que el cliente compartio (comprobante de pago, orden " +
    "de compra o factura) para que el equipo lo revise. Pasa la URL del archivo " +
    "y el tipo. El documento queda pendiente de revision; avisa al cliente que el " +
    "equipo lo validara.",
  inputSchema: z.object({
    fileUrl: z.string().url().describe("URL del archivo (imagen/PDF) compartido por el cliente."),
    type: z
      .enum(["payment_proof", "purchase_order", "invoice", "other"])
      .optional()
      .describe("Tipo de documento (default other)."),
    fileName: z.string().optional().describe("Nombre del archivo (opcional)."),
  }),
  async execute(input, ctx) {
    const tenant = getTenant(ctx);
    const result = await registerDocument(tenant, input);
    if (!result.ok) return { ok: false, message: result.message };
    return {
      ok: true,
      document: result.document,
      note: "Avisa al cliente que el equipo revisara el documento.",
    };
  },
});
