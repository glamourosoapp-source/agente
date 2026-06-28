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
 * Marca a un prospecto como contactado por WhatsApp (best-effort). No es critico
 * para la conversacion; sirve para metricas de prospeccion.
 */
export async function markProspectContacted(
  tenant: TenantContext,
  prospectId: string,
): Promise<void> {
  const sql = getSql();
  await sql`
    UPDATE prospects
    SET status = 'contacted_whatsapp', updated_at = now()
    WHERE organization_id = ${tenant.organizationId}
      AND id = ${prospectId}
      AND status = 'new'
  `;
}
