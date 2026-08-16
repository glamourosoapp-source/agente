import { getSql } from "../db.js";
import { phoneCandidates } from "../phone.js";
import type { TenantContext } from "../tenant.js";

/** Status de conversacion con una persona del equipo al mando (CONVERSATION_STATUS.HUMAN del Back). */
export const CONVERSATION_STATUS_HUMAN = "human";

/**
 * Decide si el agente debe callarse para una conversacion ya leida.
 *
 * Las tres columnas valen por separado: `status='human'` lo pone "Tomar
 * control" y el envio manual del inbox, `is_agent_active=false` el toggle, y
 * `needs_human_review=true` el handoff del propio agente.
 *
 * `null` (no hay conversacion todavia) = no pausado: es el primer mensaje del
 * cliente y el agente debe atender.
 */
export function shouldPauseAgent(state: ConversationState | null): boolean {
  if (!state) return false;
  return (
    state.isAgentActive === false ||
    state.needsHumanReview === true ||
    state.status === CONVERSATION_STATUS_HUMAN
  );
}

/**
 * Estado relevante de una conversacion para la pausa del agente.
 */
export interface ConversationState {
  conversationId: string;
  /** 'active' | 'human' | 'closed'. 'human' = alguien del equipo tomo el chat. */
  status: string;
  isAgentActive: boolean;
  needsHumanReview: boolean;
}

/** Subconjunto del tenant necesario para aislar por organizacion. */
type TenantScope = Pick<TenantContext, "organizationId">;

/**
 * Lee el estado de la conversacion de WhatsApp (org + telefono) directamente de
 * Postgres. Es el guard de pausa de respaldo cuando el puente (Back) no
 * devuelve estado.
 *
 * NO filtra por `status`: al escalar a humano (handoff o "Tomar control") el
 * Back deja `status='human'`, y filtrar por 'active' hacia que el guard no
 * encontrara la fila justo en el caso que debe cubrir -> el agente respondia
 * por encima de la persona. Mismo criterio que `ensureConversation` del Back
 * (busca por org+telefono+canal, la mas reciente).
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
      status: string;
      is_agent_active: boolean;
      needs_human_review: boolean;
    }[]
  >`
    SELECT id, status, is_agent_active, needs_human_review
    FROM conversations
    WHERE channel = 'whatsapp'
      AND organization_id = ${tenant.organizationId}
      AND contact_phone = ANY(${candidates})
    ORDER BY updated_at DESC
    LIMIT 1
  `;

  const row = rows[0];
  if (!row) return null;
  return {
    conversationId: row.id,
    status: row.status,
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
