import { randomUUID } from "node:crypto";
import { getSql } from "../db.js";
import type { TenantContext } from "../tenant.js";

// Rol reservado del usuario sistema del agente (ROLES.AGENT en shared del CRM).
// El Back lo excluye del listado de usuarios y nunca puede iniciar sesión.
const AGENT_ROLE = "agent";

const cache = new Map<string, string>();

/**
 * Devuelve el id del usuario sistema "Agente IA" de la organización, creándolo
 * la primera vez. Los pedidos del agente lo usan como created_by para que el
 * CRM muestre quién los creó.
 */
export async function getAgentUserId(tenant: TenantContext): Promise<string> {
  const cached = cache.get(tenant.organizationId);
  if (cached) return cached;

  const sql = getSql();
  const found = await sql<{ id: string }[]>`
    SELECT id FROM users
    WHERE organization_id = ${tenant.organizationId} AND role = ${AGENT_ROLE}
    LIMIT 1
  `;
  let id = found[0]?.id;

  if (!id) {
    const email = `agente-ia+${tenant.organizationId}@sistema.local`;
    // password_hash inválido a propósito: is_active=false y el login del Back
    // rechaza usuarios inactivos antes de verificar la contraseña.
    await sql`
      INSERT INTO users (id, organization_id, name, email, password_hash, role, is_active)
      VALUES (
        ${randomUUID()}, ${tenant.organizationId}, 'Agente IA', ${email},
        ${`disabled:${randomUUID()}`}, ${AGENT_ROLE}, false
      )
      ON CONFLICT (email) DO NOTHING
    `;
    const rows = await sql<{ id: string }[]>`
      SELECT id FROM users WHERE email = ${email} LIMIT 1
    `;
    id = rows[0]!.id;
  }

  cache.set(tenant.organizationId, id);
  return id;
}
