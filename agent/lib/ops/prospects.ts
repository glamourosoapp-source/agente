import { getSql } from "../db.js";
import { normalizePhoneForDb, phoneCandidates } from "../phone.js";
import type { TenantContext } from "../tenant.js";

export interface ProspectRecord {
  id: string;
  name: string;
  phone: string | null;
  businessType: string | null;
  city: string | null;
  status: string;
  metadata: Record<string, unknown> | null;
}

interface RawProspectRow {
  id: string;
  name: string;
  phone: string | null;
  business_type: string | null;
  city: string | null;
  status: string;
  metadata: Record<string, unknown> | null;
}

function mapRow(r: RawProspectRow): ProspectRecord {
  return {
    id: r.id,
    name: r.name,
    phone: r.phone,
    businessType: r.business_type,
    city: r.city,
    status: r.status,
    metadata: r.metadata,
  };
}

/**
 * Busca un prospecto por telefono dentro de la organizacion. Sirve para que el
 * subagente de prospeccion sepa con quien habla (negocio, ciudad, estado del
 * contacto) y personalice el mensaje.
 */
export async function findProspectByPhone(
  tenant: TenantContext,
  phone: string,
): Promise<ProspectRecord | null> {
  const normalized = normalizePhoneForDb(phone);
  const candidates = phoneCandidates(phone);
  if (!normalized && candidates.length === 0) return null;

  const sql = getSql();
  const rows = await sql<RawProspectRow[]>`
    SELECT id, name, phone, business_type, city, status, metadata
    FROM prospects
    WHERE organization_id = ${tenant.organizationId}
      AND (
        phone_normalized = ${normalized}
        OR phone = ANY(${candidates})
      )
    ORDER BY updated_at DESC
    LIMIT 1
  `;
  const row = rows[0];
  return row ? mapRow(row) : null;
}

/**
 * Marca que el prospecto respondio a la campaña (best-effort). No pisa el estado
 * converted y tambien registra replied_at en los recipients de campaña.
 */
export async function markProspectReplied(
  tenant: TenantContext,
  prospectId: string,
): Promise<void> {
  const sql = getSql();
  await sql`
    UPDATE prospects
    SET status = 'replied', updated_at = now()
    WHERE organization_id = ${tenant.organizationId}
      AND id = ${prospectId}
      AND status NOT IN ('replied', 'converted')
  `;
  await sql`
    UPDATE campaign_recipients
    SET replied_at = COALESCE(replied_at, now()), status = 'replied', updated_at = now()
    WHERE prospect_id = ${prospectId}
      AND replied_at IS NULL
  `;
}

/**
 * Marca al prospecto como convertido cuando su pedido se confirma: enlaza el
 * customer creado (match por telefono dentro de la organizacion) y sella
 * converted_at. Best-effort: si el telefono no corresponde a un prospecto no
 * hace nada.
 */
export async function markProspectConverted(
  tenant: TenantContext,
  phone: string,
): Promise<void> {
  const normalized = normalizePhoneForDb(phone);
  const candidates = phoneCandidates(phone);
  if (!normalized && candidates.length === 0) return;

  const sql = getSql();
  const rows = await sql<{ id: string }[]>`
    UPDATE prospects p
    SET status = 'converted',
        customer_id = COALESCE(
          (
            SELECT c.id FROM customers c
            WHERE c.organization_id = ${tenant.organizationId}
              AND (c.phone_normalized = ${normalized} OR c.phone = ANY(${candidates}))
            ORDER BY c.updated_at DESC
            LIMIT 1
          ),
          p.customer_id
        ),
        converted_at = COALESCE(p.converted_at, now()),
        updated_at = now()
    WHERE p.organization_id = ${tenant.organizationId}
      AND (p.phone_normalized = ${normalized} OR p.phone = ANY(${candidates}))
      AND p.status <> 'converted'
    RETURNING p.id
  `;

  if (rows.length > 0) {
    const ids = rows.map((r) => r.id);
    await sql`
      UPDATE campaign_recipients
      SET replied_at = COALESCE(replied_at, now()), status = 'replied', updated_at = now()
      WHERE prospect_id = ANY(${ids})
        AND replied_at IS NULL
    `;
  }
}
