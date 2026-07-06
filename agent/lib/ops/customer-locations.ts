import { extractGoogleMapsUrls } from "../google-maps-url.js";
import { getSql } from "../db.js";

/** Maximo de ubicaciones guardadas por cliente (espejo de shared/constants.ts del Back). */
const MAX_CUSTOMER_LOCATIONS = 3;
import type { TenantContext } from "../tenant.js";
import {
  findOrCreateCustomerByPhone,
  formatDeliveryAddress,
  type CustomerRecord,
} from "./customers.js";

export interface CustomerLocationRecord {
  id: string;
  customerId: string;
  label: string | null;
  street: string | null;
  colony: string | null;
  postalCode: string | null;
  city: string | null;
  zone: string | null;
  reference: string | null;
  googleMapsUrl: string | null;
  latitude: number | null;
  longitude: number | null;
  isDefault: boolean;
  sortOrder: number;
  formattedAddress: string;
}

interface RawLocationRow {
  id: string;
  customer_id: string;
  label: string | null;
  street: string | null;
  colony: string | null;
  postal_code: string | null;
  city: string | null;
  zone: string | null;
  reference: string | null;
  google_maps_url: string | null;
  latitude: string | number | null;
  longitude: string | number | null;
  is_default: boolean;
  sort_order: number;
}

function mapLocationRow(row: RawLocationRow): CustomerLocationRecord {
  const formattedAddress = formatDeliveryAddress({
    street: row.street,
    colony: row.colony,
    postalCode: row.postal_code,
    city: row.city,
    zone: row.zone,
    address: row.reference,
  });
  return {
    id: row.id,
    customerId: row.customer_id,
    label: row.label,
    street: row.street,
    colony: row.colony,
    postalCode: row.postal_code,
    city: row.city,
    zone: row.zone,
    reference: row.reference,
    googleMapsUrl: row.google_maps_url,
    latitude: row.latitude != null ? Number(row.latitude) : null,
    longitude: row.longitude != null ? Number(row.longitude) : null,
    isDefault: Boolean(row.is_default),
    sortOrder: Number(row.sort_order ?? 0),
    formattedAddress,
  };
}

export async function listCustomerLocations(
  tenant: TenantContext,
  customerId: string,
): Promise<CustomerLocationRecord[]> {
  const sql = getSql();
  const rows = await sql<RawLocationRow[]>`
    SELECT id, customer_id, label, street, colony, postal_code, city, zone, reference,
           google_maps_url, latitude, longitude, is_default, sort_order
    FROM customer_locations
    WHERE organization_id = ${tenant.organizationId}
      AND customer_id = ${customerId}
      AND deleted_at IS NULL
    ORDER BY is_default DESC, sort_order ASC, created_at ASC
  `;
  return rows.map(mapLocationRow);
}

export async function findCustomerLocationById(
  tenant: TenantContext,
  customerId: string,
  locationId: string,
): Promise<CustomerLocationRecord | null> {
  const sql = getSql();
  const rows = await sql<RawLocationRow[]>`
    SELECT id, customer_id, label, street, colony, postal_code, city, zone, reference,
           google_maps_url, latitude, longitude, is_default, sort_order
    FROM customer_locations
    WHERE organization_id = ${tenant.organizationId}
      AND customer_id = ${customerId}
      AND id = ${locationId}
      AND deleted_at IS NULL
    LIMIT 1
  `;
  return rows[0] ? mapLocationRow(rows[0]) : null;
}

async function syncCustomerDefaultCache(tenant: TenantContext, customerId: string) {
  const sql = getSql();
  const rows = await sql<RawLocationRow[]>`
    SELECT street, colony, postal_code, city, zone, reference
    FROM customer_locations
    WHERE organization_id = ${tenant.organizationId}
      AND customer_id = ${customerId}
      AND is_default = true
      AND deleted_at IS NULL
    ORDER BY sort_order ASC, created_at ASC
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) return;
  await sql`
    UPDATE customers
    SET street = ${row.street},
        colony = ${row.colony},
        postal_code = ${row.postal_code},
        city = ${row.city},
        zone = ${row.zone},
        address = ${row.reference},
        updated_at = now()
    WHERE organization_id = ${tenant.organizationId}
      AND id = ${customerId}
      AND deleted_at IS NULL
  `;
}

export interface SaveCustomerLocationInput {
  label?: string | null;
  street?: string | null;
  colony?: string | null;
  postalCode?: string | null;
  city?: string | null;
  zone?: string | null;
  reference?: string | null;
  googleMapsUrl?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  isDefault?: boolean;
  contactName?: string | null;
}

function parseSharedLocationText(text: string | null | undefined): {
  latitude: number | null;
  longitude: number | null;
  label: string | null;
} {
  const raw = String(text || "").trim();
  const match = raw.match(
    /\[Ubicacion compartida\]\s*lat:\s*(-?\d+(?:\.\d+)?),\s*lng:\s*(-?\d+(?:\.\d+)?)(?:\s*—\s*(.+))?/i,
  );
  if (!match) return { latitude: null, longitude: null, label: null };
  return {
    latitude: Number(match[1]),
    longitude: Number(match[2]),
    label: match[3]?.trim() || null,
  };
}

export async function saveCustomerLocation(
  tenant: TenantContext,
  input: SaveCustomerLocationInput,
): Promise<{ ok: boolean; location?: CustomerLocationRecord; message?: string }> {
  if (!tenant.customerPhone) {
    return { ok: false, message: "No tengo el telefono del cliente para guardar la ubicacion." };
  }

  const customer = await findOrCreateCustomerByPhone(tenant, {
    phone: tenant.customerPhone,
    name: input.contactName,
  });

  const parsedPin = parseSharedLocationText(
    [input.reference, input.street, input.colony, input.city].filter(Boolean).join(" "),
  );

  const latitude = input.latitude ?? parsedPin.latitude;
  const longitude = input.longitude ?? parsedPin.longitude;
  const reference = input.reference?.trim() || parsedPin.label || null;

  const mapsFromText = input.googleMapsUrl
    ? [input.googleMapsUrl]
    : extractGoogleMapsUrls(
        [input.street, input.colony, input.reference, input.city].filter(Boolean).join(" "),
      );
  const googleMapsUrl = mapsFromText[0] || input.googleMapsUrl || null;

  const hasStructured =
    Boolean(input.street?.trim()) &&
    Boolean(input.colony?.trim()) &&
    Boolean(input.city?.trim());
  const hasCoords =
    latitude != null &&
    longitude != null &&
    !Number.isNaN(latitude) &&
    !Number.isNaN(longitude);
  const hasMaps = Boolean(googleMapsUrl?.trim());

  if (!hasStructured && !hasCoords && !hasMaps) {
    return {
      ok: false,
      message: "Faltan datos de ubicacion (calle/colonia/ciudad, pin o link de Google Maps).",
    };
  }

  const sql = getSql();
  const countRows = await sql<{ count: string }[]>`
    SELECT COUNT(*)::int AS count
    FROM customer_locations
    WHERE organization_id = ${tenant.organizationId}
      AND customer_id = ${customer.id}
      AND deleted_at IS NULL
  `;
  const existingCount = Number(countRows[0]?.count ?? 0);
  if (existingCount >= MAX_CUSTOMER_LOCATIONS) {
    return {
      ok: false,
      message: `El cliente ya tiene el maximo de ${MAX_CUSTOMER_LOCATIONS} ubicaciones guardadas.`,
    };
  }

  const shouldBeDefault = input.isDefault === true || existingCount === 0;
  if (shouldBeDefault) {
    await sql`
      UPDATE customer_locations
      SET is_default = false, updated_at = now()
      WHERE organization_id = ${tenant.organizationId}
        AND customer_id = ${customer.id}
        AND deleted_at IS NULL
    `;
  }

  const rows = await sql<RawLocationRow[]>`
    INSERT INTO customer_locations (
      organization_id, customer_id, label, street, colony, postal_code, city, zone,
      reference, google_maps_url, latitude, longitude, is_default, sort_order
    )
    VALUES (
      ${tenant.organizationId},
      ${customer.id},
      ${input.label?.trim() || (existingCount === 0 ? "Principal" : null)},
      ${input.street?.trim() || null},
      ${input.colony?.trim() || null},
      ${input.postalCode?.trim() || null},
      ${input.city?.trim() || null},
      ${input.zone?.trim() || null},
      ${reference},
      ${googleMapsUrl},
      ${latitude ?? null},
      ${longitude ?? null},
      ${shouldBeDefault},
      ${existingCount}
    )
    RETURNING id, customer_id, label, street, colony, postal_code, city, zone, reference,
              google_maps_url, latitude, longitude, is_default, sort_order
  `;

  if (shouldBeDefault) {
    await syncCustomerDefaultCache(tenant, customer.id);
  }

  const location = mapLocationRow(rows[0]!);
  return { ok: true, location };
}

export async function resolveDeliveryAddress(
  customer: CustomerRecord,
  args: {
    deliveryAddress?: string | null;
    locationId?: string | null;
  },
  tenant: TenantContext,
): Promise<string | null> {
  const provided = String(args.deliveryAddress || "").trim();
  if (provided) return provided;

  if (args.locationId) {
    const location = await findCustomerLocationById(tenant, customer.id, args.locationId);
    if (location?.formattedAddress?.trim()) return location.formattedAddress.trim();
  }

  const locations = await listCustomerLocations(tenant, customer.id);
  const defaultLocation = locations.find((l) => l.isDefault) ?? locations[0];
  if (defaultLocation?.formattedAddress?.trim()) return defaultLocation.formattedAddress.trim();

  if (customer.formattedAddress?.trim()) return customer.formattedAddress.trim();
  return customer.hasAddress ? customer.formattedAddress : null;
}
