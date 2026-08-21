import { getSql } from "../db.js";
import type { TenantContext } from "../tenant.js";
import type { ProductHit } from "./products.js";
import type { ResolvedOrderItem } from "./orders.js";

/**
 * Bidon a cambio (regla del negocio, 2026-08-18):
 *
 * Cada envase de **20 L** sale con un bidon. El bidon se agrega SIEMPRE al
 * pedido/cotizacion como un item mas ($25 c/u) y el resumen avisa que si el
 * cliente entrega los vacios a cambio, el chofer no se los cobra. Antes se
 * preguntaba primero y el modelo decidia si agregarlo: se le olvidaba y el
 * total quedaba corto al momento de la entrega.
 *
 * Las presentaciones de 10 L NO entran aqui: siguen con la pregunta del prompt
 * (el bidon se agrega solo si el cliente dice que no entrega uno).
 */

/** Presentaciones que llevan bidon automatico (normalizadas: "20L"). */
const BIDON_PRESENTATIONS = new Set(["20L"]);

/**
 * Solo los liquidos van en bidon. Hay articulos de plastico/jarcieria que
 * comparten la presentacion "20 LITROS" (cesto papelero, cubeta, palangana) y
 * obviamente no llevan bidon a cambio.
 */
const BIDON_CATEGORIES = new Set(["liquidos", "limpieza a granel"]);

/** Nombre del producto del catalogo que representa el bidon vacio. */
const BIDON_PRODUCT_NAMES = ["BIDON", "BIDÓN"];

const CACHE_TTL_MS = 10 * 60 * 1000;

/** Producto BIDON del catalogo. */
export interface BidonProduct {
  id: string;
  name: string;
  unit: string;
  price: number;
  wholesalePrice: number | null;
}

/** Bidones agregados a un pedido/cotizacion por la politica. */
export interface BidonLine {
  quantity: number;
  unitPrice: number;
  total: number;
}

interface CacheEntry {
  at: number;
  product: BidonProduct | null;
}

const cache = new Map<string, CacheEntry>();

/** Sin acentos, sin espacios ni puntos, en minusculas. */
function normalize(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[.\s]/g, "")
    .toLowerCase();
}

/** Igual que normalize pero conservando los espacios internos. */
function normalizeLoose(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

/**
 * True si comprar ese producto agrega un bidon al pedido: envase de 20 L de
 * una linea liquida, o producto marcado a mano en el catalogo
 * (`variants.bidon` -> `ProductHit.bidon`; hay 10L que salen en bidon de 20).
 * El override tambien apaga la regla (`bidon: false`).
 */
export function carriesBidon(
  product: Pick<ProductHit, "presentation" | "categoryName" | "bidon">,
): boolean {
  if (product.bidon != null) return product.bidon;
  if (!BIDON_PRESENTATIONS.has(normalize(product.presentation).toUpperCase())) {
    return false;
  }
  return BIDON_CATEGORIES.has(normalizeLoose(product.categoryName));
}

/** Producto BIDON de la organizacion (cacheado 10 min); null si no existe. */
export async function findBidonProduct(
  tenant: TenantContext,
): Promise<BidonProduct | null> {
  const cached = cache.get(tenant.organizationId);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.product;

  const sql = getSql();
  const rows = await sql<
    {
      id: string;
      name: string;
      unit: string;
      price: string | number;
      wholesale_price: string | number | null;
    }[]
  >`
    SELECT id, name, unit, price, wholesale_price
    FROM products
    WHERE organization_id = ${tenant.organizationId}
      AND deleted_at IS NULL
      AND is_available = true
      AND upper(name) = ANY(${BIDON_PRODUCT_NAMES})
    ORDER BY created_at
    LIMIT 1
  `;

  const row = rows[0];
  const product: BidonProduct | null = row
    ? {
        id: row.id,
        name: row.name,
        unit: row.unit,
        price: Number(row.price ?? 0),
        wholesalePrice: row.wholesale_price == null ? null : Number(row.wholesale_price),
      }
    : null;

  cache.set(tenant.organizationId, { at: Date.now(), product });
  return product;
}

/** Limpia el cache (tests/scripts). */
export function clearBidonCache(): void {
  cache.clear();
}

/**
 * Agrega (o ajusta) la linea de bidones que exige la politica.
 *
 * `units` es cuantos envases de 20 L trae el pedido. Si ya venia una linea de
 * bidones (el modelo la agrego, o el pedido viene de una cotizacion que ya los
 * traia), se conserva la cantidad mayor en vez de sumar otra linea: asi
 * convertir cotizacion -> pedido no los cuenta dos veces.
 */
export function applyBidonLine(
  items: ResolvedOrderItem[],
  units: number,
  bidon: BidonProduct | null,
  pricingTier: string,
): { items: ResolvedOrderItem[]; bidonLine: BidonLine | null } {
  // Sin envases de 20 L no hay politica que aplicar: si el pedido trae bidones
  // es porque el cliente los pidio (o son de un 10 L sin intercambio), y ese
  // caso no lleva el aviso del chofer.
  if (!bidon || units <= 0) return { items, bidonLine: null };

  const existing = items.find((i) => i.productId === bidon.id);

  const useWholesale =
    pricingTier === "wholesale" && Boolean(bidon.wholesalePrice && bidon.wholesalePrice > 0);
  const unitPrice = useWholesale ? bidon.wholesalePrice! : bidon.price;
  const quantity = Math.max(units, existing?.quantity ?? 0);
  const line: ResolvedOrderItem = {
    productId: bidon.id,
    productName: bidon.name,
    unit: bidon.unit,
    quantity,
    unitPrice,
    priceTier: useWholesale ? "wholesale" : "retail",
    total: Math.round(unitPrice * quantity * 100) / 100,
    notes: "Bidón a cambio: si el cliente entrega los vacíos, el chofer no los cobra.",
  };

  const next = [...items];
  const index = next.findIndex((i) => i.productId === bidon.id);
  if (index >= 0) next[index] = line;
  else next.push(line);

  return {
    items: next,
    bidonLine: { quantity: line.quantity, unitPrice: line.unitPrice, total: line.total },
  };
}

/** Aviso que el agente debe darle al cliente cuando el pedido lleva bidones. */
export function bidonNotice(line: BidonLine | null): string | null {
  if (!line || line.quantity <= 0) return null;
  const plural = line.quantity === 1 ? "bidón" : "bidones";
  return (
    `El pedido incluye ${line.quantity} ${plural} de $${line.unitPrice} ($${line.total} en total) ` +
    `porque lleva envases de 20 L; ya estan sumados al total. Al mostrar el resumen dilo ` +
    `explicitamente: si el cliente entrega los ${plural} vacios a cambio, el chofer NO se los ` +
    `cobra y el total baja $${line.total}.`
  );
}
