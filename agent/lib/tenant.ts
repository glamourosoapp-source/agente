import { getSql } from "./db.js";
import { phoneCandidates } from "./phone.js";

/**
 * Contexto multi-tenant del turno.
 *
 * Se resuelve SIEMPRE desde el canal (numero de WhatsApp que recibio el
 * mensaje), nunca desde input del modelo. El canal lo coloca en
 * `session.auth.initiator.attributes` al iniciar/reanudar la sesion, y las
 * tools lo leen con `getTenant(ctx)`. Asi el modelo no puede cambiar de
 * organizacion.
 *
 * En Glamouroso el tenant es SOLO la organizacion (no hay segunda dimension
 * como el doctorId de CRM-MEDICO).
 */
export interface TenantContext {
  /** Organizacion duena del numero (obligatorio). */
  organizationId: string;
  /** Telefono del cliente que escribe (E.164, para pedidos/entregas). */
  customerPhone: string | null;
}

/** Forma minima del `ctx` que recibe una tool en `execute(input, ctx)`. */
export interface ToolCtxLike {
  session?: {
    auth?: {
      initiator?: { attributes?: Record<string, unknown> | null } | null;
      current?: { attributes?: Record<string, unknown> | null } | null;
    } | null;
  } | null;
}

function readTenantFromAuth(ctx: ToolCtxLike): TenantContext | null {
  const attrs =
    ctx?.session?.auth?.initiator?.attributes ??
    ctx?.session?.auth?.current?.attributes ??
    null;
  if (!attrs) return null;

  const organizationId = attrs["organizationId"];
  if (typeof organizationId !== "string" || !organizationId) return null;

  const customerPhone =
    typeof attrs["customerPhone"] === "string" && attrs["customerPhone"]
      ? (attrs["customerPhone"] as string)
      : null;

  return { organizationId, customerPhone };
}

function devFallbackTenant(): TenantContext | null {
  const organizationId = process.env.GLAM_DEV_ORGANIZATION_ID;
  if (!organizationId) return null;
  return { organizationId, customerPhone: null };
}

/**
 * Obtiene el tenant del turno desde la sesion. Falla cerrado: si no hay
 * tenant (y no hay defaults de desarrollo), lanza error en vez de exponer
 * datos de otra organizacion.
 */
export function getTenant(ctx: ToolCtxLike): TenantContext {
  const fromAuth = readTenantFromAuth(ctx);
  if (fromAuth) return fromAuth;

  const dev = devFallbackTenant();
  if (dev) return dev;

  throw new Error(
    "No se pudo resolver la organizacion del turno (tenant ausente). " +
      "El canal debe inyectar organizationId en la sesion, o define " +
      "GLAM_DEV_ORGANIZATION_ID en desarrollo.",
  );
}

type WhatsAppConfigRow = { organization_id: string | null };

/**
 * Resuelve el tenant (org) a partir del phone_number_id que entrega el webhook
 * de Kapso (forma preferida).
 */
export async function resolveTenantByPhoneNumberId(
  phoneNumberId: string,
): Promise<Omit<TenantContext, "customerPhone"> | null> {
  const id = String(phoneNumberId || "").trim();
  if (!id) return null;
  const sql = getSql();
  const rows = await sql<WhatsAppConfigRow[]>`
    SELECT organization_id
    FROM whatsapp_configs
    WHERE is_active = true
      AND phone_number_id = ${id}
    ORDER BY updated_at DESC
    LIMIT 1
  `;
  const organizationId = rows[0]?.organization_id ?? null;
  return organizationId ? { organizationId } : null;
}

/**
 * Resuelve el tenant a partir del numero de WhatsApp del NEGOCIO (fallback
 * cuando no hay phone_number_id), casando contra `display_phone`.
 */
export async function resolveTenantByBusinessPhone(
  businessPhone: string,
): Promise<Omit<TenantContext, "customerPhone"> | null> {
  const candidates = phoneCandidates(businessPhone);
  if (candidates.length === 0) return null;

  const sql = getSql();
  const rows = await sql<WhatsAppConfigRow[]>`
    SELECT organization_id
    FROM whatsapp_configs
    WHERE is_active = true
      AND display_phone = ANY(${candidates})
    ORDER BY updated_at DESC
    LIMIT 1
  `;
  const organizationId = rows[0]?.organization_id ?? null;
  return organizationId ? { organizationId } : null;
}
