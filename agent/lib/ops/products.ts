import { getSql } from "../db.js";
import { embedQuery, toPgVectorLiteral } from "../embeddings.js";
import type { TenantContext } from "../tenant.js";
import {
  buildLikePatterns,
  combineScores,
  diversifyByGroup,
  extractPresentation,
  extractProductGroupKey,
  normalizeText,
  scoreProduct,
  tokenizeQuery,
} from "./product-search.js";

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
  /** Relevancia de busqueda (0 fuera de searchProducts). */
  score: number;
  /** Presentacion ("1L", "4L", "500ml"...) desde variants o inferida del nombre. */
  presentation: string | null;
  /** Linea de producto (agrupa presentaciones, p. ej. "DETERCLORO"). */
  groupKey: string;
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
  variants: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
  category_name?: string | null;
  vector_score?: number | null;
}

const CANDIDATE_LIMIT = 500;
const VECTOR_MIN_CANDIDATES = 30;
const PRODUCT_VECTOR_ENABLED = process.env.PRODUCT_VECTOR_ENABLED !== "false";
const PER_PATTERN_LIMIT = 120;

function mapRow(r: RawProductRow, score = 0): ProductHit {
  const variants = r.variants ?? {};
  const presentation =
    typeof variants.presentacion === "string" && variants.presentacion
      ? variants.presentacion
      : extractPresentation(r.name);
  const groupKey =
    typeof variants.productGroupKey === "string" && variants.productGroupKey
      ? variants.productGroupKey
      : (extractProductGroupKey(r.name) ?? r.name);
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
    score,
    presentation,
    groupKey,
  };
}

function rowGroupKey(r: RawProductRow): string {
  const variants = r.variants ?? {};
  if (typeof variants.productGroupKey === "string" && variants.productGroupKey) {
    return variants.productGroupKey;
  }
  return extractProductGroupKey(r.name) ?? r.name;
}

function rowMetadataText(metadata: Record<string, unknown> | null | undefined): string {
  if (!metadata) return "";
  const useCases = Array.isArray(metadata.useCases)
    ? metadata.useCases.filter((v): v is string => typeof v === "string").join(" ")
    : "";
  return useCases || JSON.stringify(metadata);
}

function rankHits(
  rows: RawProductRow[],
  queryNorm: string,
  tokens: string[],
  useVector: boolean,
): ProductHit[] {
  return rows
    .map((r) => {
      const heuristic = scoreProduct(queryNorm, tokens, {
        name: r.name,
        description: r.description,
        sku: r.sku,
        isAvailable: r.is_available,
        stock: Number(r.stock ?? 0),
        categoryName: r.category_name ?? null,
        groupKey: rowGroupKey(r),
        metadataText: rowMetadataText(r.metadata),
      });
      const vector =
        useVector && typeof r.vector_score === "number" ? r.vector_score : 0;
      const combined =
        heuristic > 0 || vector > 0 ? combineScores(vector, heuristic) : 0;
      return mapRow(r, combined);
    })
    .filter((h) => h.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        Number(b.isAvailable) - Number(a.isAvailable) ||
        a.name.localeCompare(b.name),
    );
}

async function fetchHeuristicCandidates(
  tenant: TenantContext,
  patterns: string[],
  includeUnavailable: boolean,
): Promise<RawProductRow[]> {
  const sql = getSql();
  const byId = new Map<string, RawProductRow>();
  const perPattern = Math.min(
    PER_PATTERN_LIMIT,
    Math.ceil(CANDIDATE_LIMIT / Math.max(patterns.length, 1)),
  );

  // Una consulta por patron evita que ORDER BY name + LIMIT global deje fuera
  // productos relevantes con nombre tardio en el alfabeto (p. ej. MAX COLOR).
  for (const pattern of patterns) {
    const rows = await sql<RawProductRow[]>`
      SELECT p.id, p.sku, p.name, p.description, p.unit, p.price, p.wholesale_price, p.stock, p.is_available, p.variants, p.metadata,
        pc.name AS category_name
      FROM products p
      LEFT JOIN product_categories pc ON pc.id = p.category_id
      WHERE p.organization_id = ${tenant.organizationId}
        AND p.deleted_at IS NULL
        ${includeUnavailable ? sql`` : sql`AND p.is_available = true`}
        AND translate(
          lower(
            p.name || ' ' || coalesce(p.description, '') || ' ' || coalesce(p.sku, '') || ' ' ||
            coalesce(p.variants->>'productGroupKey', '') || ' ' || coalesce(p.variants->>'presentacion', '') || ' ' ||
            coalesce(pc.name, '') || ' ' || coalesce(p.metadata::text, '')
          ),
          'áéíóúüñ', 'aeiouun'
        ) LIKE ${pattern}
      LIMIT ${perPattern}
    `;
    for (const row of rows) byId.set(row.id, row);
    if (byId.size >= CANDIDATE_LIMIT) break;
  }

  return [...byId.values()].slice(0, CANDIDATE_LIMIT);
}

async function fetchVectorCandidates(
  tenant: TenantContext,
  queryEmbedding: number[],
  pool: number,
  includeUnavailable: boolean,
): Promise<RawProductRow[] | null> {
  const sql = getSql();
  const literal = toPgVectorLiteral(queryEmbedding);
  try {
    return await sql<RawProductRow[]>`
      SELECT id, sku, name, description, unit, price, wholesale_price, stock, is_available, variants,
        CASE
          WHEN search_embedding IS NOT NULL
          THEN 1 - (search_embedding <=> ${literal}::vector)
          ELSE NULL
        END AS vector_score
      FROM products
      WHERE organization_id = ${tenant.organizationId}
        AND deleted_at IS NULL
        ${includeUnavailable ? sql`` : sql`AND is_available = true`}
        AND search_embedding IS NOT NULL
        AND embedding_status = 'ready'
      ORDER BY search_embedding <=> ${literal}::vector
      LIMIT ${pool}
    `;
  } catch {
    return null;
  }
}

function mergeCandidateRows(
  vectorRows: RawProductRow[],
  heuristicRows: RawProductRow[],
): RawProductRow[] {
  const byId = new Map<string, RawProductRow>();
  for (const row of [...vectorRows, ...heuristicRows]) {
    const existing = byId.get(row.id);
    if (!existing) {
      byId.set(row.id, row);
      continue;
    }
    const vNew = row.vector_score ?? 0;
    const vOld = existing.vector_score ?? 0;
    if (vNew > vOld) existing.vector_score = row.vector_score;
    if (!existing.category_name && row.category_name) {
      existing.category_name = row.category_name;
    }
    if (!existing.metadata && row.metadata) {
      existing.metadata = row.metadata;
    }
  }
  return [...byId.values()];
}

/**
 * Busca productos del catalogo de la organizacion por nombre, descripcion o SKU.
 * Filtra SIEMPRE por organization_id. Por defecto solo disponibles.
 *
 * Busqueda hibrida: kNN pgvector (si hay embeddings) + tokens/heuristica.
 * Con `diversify` limita a 2 presentaciones por linea de producto.
 */
export async function searchProducts(
  tenant: TenantContext,
  query: string,
  opts: { limit?: number; includeUnavailable?: boolean; diversify?: boolean } = {},
): Promise<ProductHit[]> {
  const limit = Math.min(Math.max(opts.limit ?? 8, 1), 25);
  const queryNorm = normalizeText(query);
  if (!queryNorm) return [];

  const tokens = tokenizeQuery(query);
  const patterns =
    tokens.length > 0 ? buildLikePatterns(tokens) : [`%${queryNorm}%`];

  const heuristicRows = await fetchHeuristicCandidates(
    tenant,
    patterns,
    !!opts.includeUnavailable,
  );

  let vectorRows: RawProductRow[] = [];
  let useVector = false;
  if (PRODUCT_VECTOR_ENABLED) {
    try {
      const embedding = await embedQuery(query);
      const pool = Math.max(limit * 4, VECTOR_MIN_CANDIDATES);
      const rows = await fetchVectorCandidates(
        tenant,
        embedding,
        pool,
        !!opts.includeUnavailable,
      );
      if (rows?.length) {
        vectorRows = rows;
        useVector = true;
      }
    } catch {
      // Sin gateway o columna vector: solo heuristica.
    }
  }

  const merged = mergeCandidateRows(vectorRows, heuristicRows);
  const hits = rankHits(merged, queryNorm, tokens, useVector);

  return opts.diversify
    ? diversifyByGroup(hits, (h) => h.groupKey, limit)
    : hits.slice(0, limit);
}

/** Trae un producto por id (con scope de organizacion). */
export async function getProductById(
  tenant: TenantContext,
  productId: string,
): Promise<ProductHit | null> {
  const sql = getSql();
  const rows = await sql<RawProductRow[]>`
    SELECT id, sku, name, description, unit, price, wholesale_price, stock, is_available, variants
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
