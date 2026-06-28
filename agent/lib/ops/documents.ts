import { getSql } from "../db.js";
import type { TenantContext } from "../tenant.js";
import { findCustomerByPhone } from "./customers.js";
import { getActiveConversationId } from "./conversations.js";

/** Tipos de documento (espejo de DocumentType en document.model.ts). */
export const DOCUMENT_TYPE = {
  PAYMENT_PROOF: "payment_proof",
  PURCHASE_ORDER: "purchase_order",
  INVOICE: "invoice",
  OTHER: "other",
} as const;

/** Estados de documento (espejo de DocumentStatus en document.model.ts). */
export const DOCUMENT_STATUS = {
  PENDING_REVIEW: "pending_review",
  APPROVED: "approved",
  REJECTED: "rejected",
  PROCESSING: "processing",
} as const;

export interface DocumentRecord {
  id: string;
  type: string;
  status: string;
  fileName: string | null;
  fileUrl: string;
  createdAt: string;
}

interface RawDocRow {
  id: string;
  type: string;
  status: string;
  file_name: string | null;
  file_url: string;
  created_at: string;
}

function mapRow(r: RawDocRow): DocumentRecord {
  return {
    id: r.id,
    type: r.type,
    status: r.status,
    fileName: r.file_name,
    fileUrl: r.file_url,
    createdAt: String(r.created_at),
  };
}

/**
 * Registra un documento enviado por el cliente (comprobante de pago, orden de
 * compra, factura) para revision humana. Lo deja en estado pending_review y lo
 * enlaza a la conversacion y al cliente cuando se conocen.
 */
export async function registerDocument(
  tenant: TenantContext,
  args: { fileUrl: string; type?: string; fileName?: string | null },
): Promise<{ ok: true; document: DocumentRecord } | { ok: false; message: string }> {
  const fileUrl = String(args.fileUrl || "").trim();
  if (!fileUrl) return { ok: false, message: "Falta la URL del archivo." };

  const type = (Object.values(DOCUMENT_TYPE) as string[]).includes(String(args.type))
    ? String(args.type)
    : DOCUMENT_TYPE.OTHER;

  const sql = getSql();
  const customer = tenant.customerPhone
    ? await findCustomerByPhone(tenant, tenant.customerPhone)
    : null;
  const conversationId = tenant.customerPhone
    ? await getActiveConversationId(tenant, tenant.customerPhone)
    : null;

  const rows = await sql<RawDocRow[]>`
    INSERT INTO documents (
      organization_id, conversation_id, customer_id, type, file_url, file_name, status
    ) VALUES (
      ${tenant.organizationId}, ${conversationId}, ${customer?.id ?? null}, ${type},
      ${fileUrl}, ${args.fileName ?? null}, ${DOCUMENT_STATUS.PENDING_REVIEW}
    )
    RETURNING id, type, status, file_name, file_url, created_at
  `;
  return { ok: true, document: mapRow(rows[0]!) };
}

/** Lista los documentos pendientes de revision de la organizacion. */
export async function getPendingDocuments(
  tenant: TenantContext,
  limit = 10,
): Promise<DocumentRecord[]> {
  const sql = getSql();
  const rows = await sql<RawDocRow[]>`
    SELECT id, type, status, file_name, file_url, created_at
    FROM documents
    WHERE organization_id = ${tenant.organizationId}
      AND status = ${DOCUMENT_STATUS.PENDING_REVIEW}
    ORDER BY created_at DESC
    LIMIT ${Math.min(Math.max(limit, 1), 50)}
  `;
  return rows.map(mapRow);
}

/** Aprueba un documento (scope organizacion). */
export async function approveDocument(
  tenant: TenantContext,
  documentId: string,
  notes?: string | null,
): Promise<{ ok: boolean; message?: string }> {
  const sql = getSql();
  const rows = await sql<{ id: string }[]>`
    UPDATE documents
    SET status = ${DOCUMENT_STATUS.APPROVED},
        review_notes = ${notes ?? null},
        reviewed_at = now(),
        updated_at = now()
    WHERE organization_id = ${tenant.organizationId}
      AND id = ${documentId}
    RETURNING id
  `;
  if (!rows[0]) return { ok: false, message: "No encontre ese documento." };
  return { ok: true };
}

/** Rechaza un documento con motivo (scope organizacion). */
export async function rejectDocument(
  tenant: TenantContext,
  documentId: string,
  notes?: string | null,
): Promise<{ ok: boolean; message?: string }> {
  const sql = getSql();
  const rows = await sql<{ id: string }[]>`
    UPDATE documents
    SET status = ${DOCUMENT_STATUS.REJECTED},
        review_notes = ${notes ?? null},
        reviewed_at = now(),
        updated_at = now()
    WHERE organization_id = ${tenant.organizationId}
      AND id = ${documentId}
    RETURNING id
  `;
  if (!rows[0]) return { ok: false, message: "No encontre ese documento." };
  return { ok: true };
}
