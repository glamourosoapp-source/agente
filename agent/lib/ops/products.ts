import { getSql } from "../db.js";
import type { TenantContext } from "../tenant.js";

export interface ProductHit {
  id: string;
  sku: string | null;
  name: string;
  description: string | null;
  unit: string;
  price: number;
  wholesalePrice: number | null;
  stock: number;
  isAvailable: boolean;
}

interface RawProductRow {
  id: string;
  sku: string | null;
  name: string;
  description: string | null;
  unit: string;
  price: string | number;
  wholesale_price: string | number | null;
  stock: string | number | null;
  is_available: boolean;
}

function mapRow(r: RawProductRow): ProductHit {
  return {
    id: r.id,
    sku: r.sku,
    name: r.name,
    description: r.description,
    unit: r.unit,
    price: Number(r.price ?? 0),
    wholesalePrice: r.wholesale_price == null ? null : Number(r.wholesale_price),
    stock: Number(r.stock ?? 0),
    isAvailable: r.is_available,
  };
}

/**
 * Busca productos del catalogo de la organizacion por nombre, descripcion o SKU.
 * Filtra SIEMPRE por organization_id. Por defecto solo disponibles.
 */
export async function searchProducts(
  tenant: TenantContext,
  query: string,
  opts: { limit?: number; includeUnavailable?: boolean } = {},
): Promise<ProductHit[]> {
  const sql = getSql();
  const limit = Math.min(Math.max(opts.limit ?? 8, 1), 25);
  const term = `%${String(query || "").trim()}%`;

  const rows = await sql<RawProductRow[]>`
    SELECT id, sku, name, description, unit, price, wholesale_price, stock, is_available
    FROM products
    WHERE organization_id = ${tenant.organizationId}
      AND deleted_at IS NULL
      ${opts.includeUnavailable ? sql`` : sql`AND is_available = true`}
      AND (
        name ILIKE ${term}
        OR description ILIKE ${term}
        OR sku ILIKE ${term}
      )
    ORDER BY is_available DESC, name ASC
    LIMIT ${limit}
  `;
  return rows.map(mapRow);
}

/** Trae un producto por id (con scope de organizacion). */
export async function getProductById(
  tenant: TenantContext,
  productId: string,
): Promise<ProductHit | null> {
  const sql = getSql();
  const rows = await sql<RawProductRow[]>`
    SELECT id, sku, name, description, unit, price, wholesale_price, stock, is_available
    FROM products
    WHERE organization_id = ${tenant.organizationId}
      AND deleted_at IS NULL
      AND id = ${productId}
    LIMIT 1
  `;
  const row = rows[0];
  return row ? mapRow(row) : null;
}

/**
 * Verifica disponibilidad/stock de un producto por id o por nombre.
 * Si recibe nombre, usa el mejor match de busqueda.
 */
export async function checkProductAvailability(
  tenant: TenantContext,
  ref: { productId?: string; name?: string },
): Promise<
  | { found: false }
  | {
      found: true;
      product: ProductHit;
      available: boolean;
      stock: number;
    }
> {
  let product: ProductHit | null = null;
  if (ref.productId) {
    product = await getProductById(tenant, ref.productId);
  } else if (ref.name) {
    const hits = await searchProducts(tenant, ref.name, {
      limit: 1,
      includeUnavailable: true,
    });
    product = hits[0] ?? null;
  }

  if (!product) return { found: false };
  return {
    found: true,
    product,
    available: product.isAvailable && product.stock > 0,
    stock: product.stock,
  };
}
