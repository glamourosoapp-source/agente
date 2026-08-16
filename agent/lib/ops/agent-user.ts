import { randomUUID } from "node:crypto";
import { getSql } from "../db.js";
import type { TenantContext } from "../tenant.js";

// Rol reservado del usuario sistema del agente (ROLES.AGENT en shared del CRM).
// El Back lo excluye del listado de usuarios y nunca puede iniciar sesión.
const AGENT_ROLE = "agent";

// Equipo seed al que pertenece el usuario sistema del agente (migración
// seed-teams-and-backfill del Back).
const AGENT_TEAM_NAME = "Glamouroso IA";

const cache = new Map<string, string>();
const teamCache = new Map<string, string | null>();

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
    // team_id: subquery al equipo "Glamouroso IA"; NULL si aún no existe.
    await sql`
      INSERT INTO users (id, organization_id, name, email, password_hash, role, is_active, team_id, created_at, updated_at)
      VALUES (
        ${randomUUID()}, ${tenant.organizationId}, 'Agente IA', ${email},
        ${`disabled:${randomUUID()}`}, ${AGENT_ROLE}, false,
        (SELECT id FROM teams WHERE organization_id = ${tenant.organizationId} AND name = ${AGENT_TEAM_NAME} LIMIT 1),
        NOW(), NOW()
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

/**
 * Equipo del usuario agente (para customers.team_id). Si el usuario quedó sin
 * equipo (instancia que arrancó antes de la migración de teams), intenta
 * auto-repararlo apuntándolo a "Glamouroso IA". Devuelve null si no hay equipo.
 */
export async function getAgentTeamId(tenant: TenantContext): Promise<string | null> {
  if (teamCache.has(tenant.organizationId)) return teamCache.get(tenant.organizationId)!;

  const userId = await getAgentUserId(tenant);
  const sql = getSql();
  const rows = await sql<{ team_id: string | null }[]>`
    SELECT team_id FROM users WHERE id = ${userId} LIMIT 1
  `;
  let teamId = rows[0]?.team_id ?? null;

  if (!teamId) {
    const repaired = await sql<{ team_id: string | null }[]>`
      UPDATE users
      SET team_id = (SELECT id FROM teams WHERE organization_id = ${tenant.organizationId} AND name = ${AGENT_TEAM_NAME} LIMIT 1)
      WHERE id = ${userId} AND team_id IS NULL
      RETURNING team_id
    `;
    teamId = repaired[0]?.team_id ?? null;
  }

  // Solo cachear cuando hay equipo: si aún no existe, reintenta en el próximo turno.
  if (teamId) teamCache.set(tenant.organizationId, teamId);
  return teamId;
}
