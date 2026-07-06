import { randomUUID } from "node:crypto";
import { getSql } from "../db.js";
import { normalizePhoneForDb, phoneCandidates, toE164 } from "../phone.js";
import type { TenantContext } from "../tenant.js";

export interface CustomerRecord {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  street: string | null;
  colony: string | null;
  postalCode: string | null;
  city: string | null;
  zone: string | null;
  address: string | null;
  formattedAddress: string;
  pricingTier: string;
  hasAddress: boolean;
}

interface RawCustomerRow {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  street: string | null;
  colony: string | null;
  postal_code: string | null;
  city: string | null;
  zone: string | null;
  address: string | null;
  pricing_tier: string | null;
}

/** Une las partes de direccion en una linea legible (espejo de formatCustomerDeliveryAddress del Back). */
export function formatDeliveryAddress(parts: {
  street?: string | null;
  colony?: string | null;
  postalCode?: string | null;
  city?: string | null;
  zone?: string | null;
  address?: string | null;
}): string {
  const segments: string[] = [];
  if (parts.street?.trim()) segments.push(parts.street.trim());
  if (parts.colony?.trim()) segments.push(`Col. ${parts.colony.trim()}`);
  if (parts.postalCode?.trim()) segments.push(`CP ${parts.postalCode.trim()}`);
  if (parts.city?.trim()) segments.push(parts.city.trim());
  if (parts.zone?.trim()) segments.push(`Zona ${parts.zone.trim()}`);
  let result = segments.join(", ");
  if (parts.address?.trim()) {
    result = result ? `${result}. Ref: ${parts.address.trim()}` : `Ref: ${parts.address.trim()}`;
  }
  return result;
}

function mapRow(r: RawCustomerRow): CustomerRecord {
  const formattedAddress = formatDeliveryAddress({
    street: r.street,
    colony: r.colony,
    postalCode: r.postal_code,
    city: r.city,
    zone: r.zone,
    address: r.address,
  });
  return {
    id: r.id,
    name: r.name,
    phone: r.phone,
    email: r.email,
    street: r.street,
    colony: r.colony,
    postalCode: r.postal_code,
    city: r.city,
    zone: r.zone,
    address: r.address,
    formattedAddress,
    pricingTier: r.pricing_tier || "retail",
    hasAddress: formattedAddress.trim().length > 0,
  };
}

/** Busca un cliente por telefono dentro de la organizacion. */
export async function findCustomerByPhone(
  tenant: TenantContext,
  phone: string,
): Promise<CustomerRecord | null> {
  const normalized = normalizePhoneForDb(phone);
  const candidates = phoneCandidates(phone);
  if (!normalized && candidates.length === 0) return null;

  const sql = getSql();
  const rows = await sql<RawCustomerRow[]>`
    SELECT id, name, phone, email, street, colony, postal_code, city, zone, address, pricing_tier
    FROM customers
    WHERE organization_id = ${tenant.organizationId}
      AND deleted_at IS NULL
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
 * Busca el cliente por telefono y, si no existe, lo crea con el nombre dado.
 * Es la entrada canonica para enlazar pedidos/cotizaciones a un cliente.
 */
export async function findOrCreateCustomerByPhone(
  tenant: TenantContext,
  data: { phone: string; name?: string | null },
): Promise<CustomerRecord> {
  const existing = await findCustomerByPhone(tenant, data.phone);
  if (existing) return existing;

  const sql = getSql();
  const phone = toE164(data.phone) || data.phone;
  const phoneNormalized = normalizePhoneForDb(data.phone);
  const name = String(data.name || "Cliente WhatsApp").trim() || "Cliente WhatsApp";

  const customerId = randomUUID();
  const rows = await sql<RawCustomerRow[]>`
    INSERT INTO customers (id, organization_id, name, phone, phone_normalized, source)
    VALUES (${customerId}, ${tenant.organizationId}, ${name}, ${phone}, ${phoneNormalized}, 'whatsapp')
    RETURNING id, name, phone, email, street, colony, postal_code, city, zone, address, pricing_tier
  `;
  return mapRow(rows[0]!);
}

export interface CustomerUpdate {
  name?: string | null;
  email?: string | null;
  street?: string | null;
  colony?: string | null;
  postalCode?: string | null;
  city?: string | null;
  zone?: string | null;
  address?: string | null;
}

/** Actualiza datos del cliente (solo los campos provistos). Scope por organizacion. */
export async function updateCustomer(
  tenant: TenantContext,
  customerId: string,
  updates: CustomerUpdate,
): Promise<CustomerRecord | null> {
  const sql = getSql();

  // Construye el objeto de columnas a actualizar (snake_case) solo con lo provisto.
  const set: Record<string, string | null> = {};
  if (updates.name !== undefined) set.name = updates.name;
  if (updates.email !== undefined) set.email = updates.email;
  if (updates.street !== undefined) set.street = updates.street;
  if (updates.colony !== undefined) set.colony = updates.colony;
  if (updates.postalCode !== undefined) set.postal_code = updates.postalCode;
  if (updates.city !== undefined) set.city = updates.city;
  if (updates.zone !== undefined) set.zone = updates.zone;
  if (updates.address !== undefined) set.address = updates.address;

  if (Object.keys(set).length === 0) {
    return findCustomerById(tenant, customerId);
  }

  const rows = await sql<RawCustomerRow[]>`
    UPDATE customers
    SET ${sql(set)}, updated_at = now()
    WHERE organization_id = ${tenant.organizationId}
      AND deleted_at IS NULL
      AND id = ${customerId}
    RETURNING id, name, phone, email, street, colony, postal_code, city, zone, address, pricing_tier
  `;
  const row = rows[0];
  return row ? mapRow(row) : null;
}

/** Trae un cliente por id (scope organizacion). */
export async function findCustomerById(
  tenant: TenantContext,
  customerId: string,
): Promise<CustomerRecord | null> {
  const sql = getSql();
  const rows = await sql<RawCustomerRow[]>`
    SELECT id, name, phone, email, street, colony, postal_code, city, zone, address, pricing_tier
    FROM customers
    WHERE organization_id = ${tenant.organizationId}
      AND deleted_at IS NULL
      AND id = ${customerId}
    LIMIT 1
  `;
  const row = rows[0];
  return row ? mapRow(row) : null;
}
