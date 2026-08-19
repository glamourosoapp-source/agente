import { getSql } from "../db.js";
import type { TenantContext } from "../tenant.js";
import { stockEnforced } from "./products.js";

/** Rubro del catalogo con ejemplos reales de productos. */
export interface CatalogCategory {
  name: string;
  productCount: number;
  /** Muestra estable de nombres de producto de ese rubro. */
  examples: string[];
}

/**
 * Rubros "de relleno" del catalogo importado: no son categorias que el cliente
 * reconozca, no deben ofrecerse como algo que vendemos.
 */
const HIDDEN_CATEGORIES = new Set(["sin categoria", "sin categoría", "otros"]);

const EXAMPLES_PER_CATEGORY = 8;
const CACHE_TTL_MS = 10 * 60 * 1000;

interface CacheEntry {
  at: number;
  categories: CatalogCategory[];
}

const cache = new Map<string, CacheEntry>();

interface CategoryRow {
  name: string;
  product_count: string | number;
  examples: string[] | null;
}

/**
 * Rubros del catalogo de la organizacion, con cuantos productos disponibles
 * tiene cada uno y una muestra de nombres reales.
 *
 * Sirve para que el agente pueda decir QUE vendemos sin inventar categorias
 * (regla de oro) y sin ofrecer un "catalogo" que no existe como documento. La
 * muestra usa `md5(id)` como orden: es estable entre turnos pero no alfabetica,
 * asi los ejemplos representan al rubro en vez de amontonarse en la letra A.
 *
 * Cacheado 10 min por organizacion: el catalogo cambia poco y esto se inyecta
 * en el system prompt en cada turno.
 */
export async function getCatalogCategories(
  tenant: TenantContext,
): Promise<CatalogCategory[]> {
  const cached = cache.get(tenant.organizationId);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.categories;

  const sql = getSql();
  // Espejo de isEffectivelyAvailable (products.ts): con el enforcement apagado
  // stock=0 significa "inventario no rastreado", no agotado.
  const enforce = stockEnforced();
  const rows = await sql<CategoryRow[]>`
    SELECT
      pc.name,
      COUNT(*)::int AS product_count,
      (ARRAY_AGG(p.name ORDER BY MD5(p.id::text)))[1:${EXAMPLES_PER_CATEGORY}] AS examples
    FROM product_categories pc
    JOIN products p
      ON p.category_id = pc.id
     AND p.organization_id = pc.organization_id
    WHERE pc.organization_id = ${tenant.organizationId}
      AND p.is_available = true
      AND (${!enforce} OR p.unlimited_stock IS DISTINCT FROM false OR p.stock > 0)
    GROUP BY pc.id, pc.name, pc.sort_order
    ORDER BY pc.sort_order, pc.name
  `;

  const categories = rows
    .filter((r) => !HIDDEN_CATEGORIES.has(r.name.trim().toLowerCase()))
    .map((r) => ({
      name: r.name,
      productCount: Number(r.product_count ?? 0),
      examples: (r.examples ?? []).filter(Boolean),
    }))
    .filter((c) => c.productCount > 0);

  cache.set(tenant.organizationId, { at: Date.now(), categories });
  return categories;
}

/** Limpia el cache (tests/scripts). */
export function clearCatalogOverviewCache(): void {
  cache.clear();
}

/**
 * Markdown que se inyecta en el system prompt: que rubros existen de verdad y
 * como hablar de ellos con el cliente.
 */
export function catalogOverviewMarkdown(categories: CatalogCategory[]): string {
  if (categories.length === 0) return "";
  const lines = categories.map(
    (c) =>
      `- **${c.name}** (${c.productCount} productos): ${c.examples.join(", ")}`,
  );
  return [
    "## Rubros que SÍ manejamos (datos reales del catálogo)",
    "",
    ...lines,
    "",
    "- Es la lista completa de rubros con productos disponibles hoy; no existen",
    "  otros. Los ejemplos son una muestra, no todo lo que hay de ese rubro.",
    "- Úsala cuando el cliente no sabe qué pedir o pregunta qué vendemos:",
    "  menciona 2–3 rubros, nunca la lista completa.",
    "- El nombre del rubro es interno (jerga de bodega): tradúcelo a lo que el",
    "  cliente reconoce, apoyándote en los ejemplos de ese rubro (\"limpiadores y",
    "  químicos\", \"escobas, trapeadores y fibras\", \"papel y desechables\"). No lo",
    "  copies tal cual ni escribas los productos en MAYÚSCULAS.",
    "- No prometas mandar un catálogo, PDF o lista de precios: no existe. Para",
    "  precios y presentaciones siempre `search_products`.",
  ].join("\n");
}
