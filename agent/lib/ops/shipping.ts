/**
 * Politica de envio y cobertura de Glamouroso (Guadalajara, Jalisco, MX).
 *
 * Todo es CONFIGURABLE por variables de entorno, con defaults del negocio:
 * - Cobertura: toda la Zona Metropolitana de Guadalajara (de Chapala a Tesistan,
 *   incluyendo La Venta del Astillero y El Salto).
 * - Envio GRATIS en compras a partir de $100 MXN (GLAM_FREE_SHIPPING_MIN).
 * - Bajo ese monto se cobra GLAM_DELIVERY_FEE (default 0 = tambien gratis).
 *
 * La verificacion de cobertura es por texto (municipio/zona/colonia conocidos),
 * no geografica: si no reconoce el lugar devuelve "unknown" para que el agente
 * pregunte o derive, en vez de prometer una entrega imposible.
 */

export interface ShippingPolicy {
  /** Descripcion legible de la cobertura (para decirsela al cliente). */
  coverageText: string;
  /** Monto minimo de compra (MXN) para envio gratis. */
  freeShippingMin: number;
  /** Costo de envio (MXN) cuando la compra no alcanza el minimo. */
  deliveryFee: number;
}

/** Zonas/municipios cubiertos por defecto (ZMG + Chapala). */
const DEFAULT_AREAS = [
  "guadalajara",
  "zapopan",
  "tlaquepaque",
  "san pedro tlaquepaque",
  "tonala",
  "tlajomulco",
  "tlajomulco de zuniga",
  "el salto",
  "chapala",
  "tesistan",
  "la venta del astillero",
  "juanacatlan",
  "ixtlahuacan de los membrillos",
];

const DEFAULT_COVERAGE_TEXT =
  "Entregamos en toda la Zona Metropolitana de Guadalajara: desde Chapala hasta " +
  "Tesistan, incluyendo La Venta del Astillero y El Salto.";

/** Quita acentos y normaliza para comparar lugares. */
function normalizePlace(text: string): string {
  return (text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Zonas cubiertas: GLAM_DELIVERY_AREAS (coma-separado) o el default ZMG. */
export function coveredAreas(): string[] {
  const raw = (process.env.GLAM_DELIVERY_AREAS || "").trim();
  if (!raw) return DEFAULT_AREAS;
  return raw
    .split(",")
    .map((a) => normalizePlace(a))
    .filter((a) => a.length > 0);
}

/** Politica vigente de envio (configurable por env). */
export function shippingPolicy(): ShippingPolicy {
  const freeMin = Number(process.env.GLAM_FREE_SHIPPING_MIN);
  const fee = Number(process.env.GLAM_DELIVERY_FEE);
  return {
    coverageText: (process.env.GLAM_COVERAGE_TEXT || "").trim() || DEFAULT_COVERAGE_TEXT,
    freeShippingMin: Number.isFinite(freeMin) && freeMin >= 0 ? freeMin : 100,
    deliveryFee: Number.isFinite(fee) && fee >= 0 ? fee : 0,
  };
}

/**
 * Costo de envio para un subtotal dado, segun la politica:
 * subtotal >= minimo -> gratis; abajo -> GLAM_DELIVERY_FEE.
 */
export function deliveryFeeFor(subtotal: number): number {
  const policy = shippingPolicy();
  return Number(subtotal) >= policy.freeShippingMin ? 0 : policy.deliveryFee;
}

export type CoverageResult =
  | { covered: true; matchedArea: string }
  | { covered: false }
  | { covered: "unknown" };

/**
 * Verifica si un lugar (municipio, zona, colonia o direccion) esta dentro de la
 * cobertura. Match por texto en ambos sentidos (el area aparece en el texto o
 * viceversa). Si nada casa, devuelve "unknown" (no un "no" rotundo): el texto
 * puede ser una colonia que si este dentro de la ZMG.
 */
export function checkCoverage(place: string): CoverageResult {
  const normalized = normalizePlace(place);
  if (!normalized) return { covered: "unknown" };

  for (const area of coveredAreas()) {
    if (normalized.includes(area) || area.includes(normalized)) {
      return { covered: true, matchedArea: area };
    }
  }
  return { covered: "unknown" };
}
