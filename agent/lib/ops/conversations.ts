import { getSql } from "../db.js";
import { phoneCandidates } from "../phone.js";
import type { TenantContext } from "../tenant.js";

/**
 * Estado relevante de una conversacion para la pausa del agente.
 */
export interface ConversationState {
  conversationId: string;
  isAgentActive: boolean;
  needsHumanReview: boolean;
}

/** Subconjunto del tenant necesario para aislar por organizacion. */
type TenantScope = Pick<TenantContext, "organizationId">;

/**
 * Lee el estado de la conversacion activa de WhatsApp (org + telefono)
 * directamente de Postgres. Es el guard de pausa de respaldo cuando el puente
 * (Back) no devuelve estado.
 *
 * Filtra SIEMPRE por organization_id para no cruzar datos entre organizaciones.
 */
export async function getConversationState(
  tenant: TenantScope,
  customerPhone: string,
): Promise<ConversationState | null> {
  const candidates = phoneCandidates(customerPhone);
  if (candidates.length === 0) return null;

  const sql = getSql();
  const rows = await sql<
    {
      id: string;
      is_agent_active: boolean;
      needs_human_review: boolean;
    }[]
  >`
    SELECT id, is_agent_active, needs_human_review
    FROM conversations
    WHERE channel = 'whatsapp'
      AND status = 'active'
      AND organization_id = ${tenant.organizationId}
      AND contact_phone = ANY(${candidates})
    ORDER BY updated_at DESC
    LIMIT 1
  `;

  const row = rows[0];
  if (!row) return null;
  return {
    conversationId: row.id,
    isAgentActive: row.is_agent_active,
    needsHumanReview: row.needs_human_review,
  };
}

/**
 * Devuelve el id de la conversacion activa de WhatsApp del cliente (para enlazar
 * pedidos/cotizaciones/documentos creados por el agente). null si no existe.
 */
export async function getActiveConversationId(
  tenant: TenantScope,
  customerPhone: string,
): Promise<string | null> {
  const state = await getConversationState(tenant, customerPhone);
  return state?.conversationId ?? null;
}
