/**
 * Tokenizacion, ranking y agrupacion para la busqueda de productos.
 * Funciones puras (sin DB) para poder testearlas con bun:test.
 *
 * Estrategia: el SQL trae candidatos amplios (OR de tokens) y aqui se rankea
 * por relevancia — mas tokens coincididos gana, name pesa mas que description,
 * y el match exacto de nombre/SKU siempre queda primero (resolveOrderItems
 * depende de eso).
 */

/** Palabras vacias en espanol tipicas de frases de cliente ("algo para la ropa"). */
export const SPANISH_STOPWORDS = new Set([
  "de",
  "del",
  "la",
  "el",
  "los",
  "las",
  "un",
  "una",
  "uno",
  "unos",
  "unas",
  "para",
  "por",
  "con",
  "sin",
  "que",
  "en",
  "al",
  "les",
  "sus",
  "este",
  "esta",
  "esto",
  "ese",
  "esa",
  "eso",
  "mas",
  "muy",
  "algo",
  "algun",
  "alguna",
  "alguno",
  "tipo",
  "quiero",
  "quisiera",
  "necesito",
  "ocupo",
  "busco",
  "buscando",
  "tienes",
  "tiene",
  "tienen",
  "tendras",
  "hay",
  "habra",
  "dame",
  "deme",
  "venden",
  "vende",
  "manejan",
  "maneja",
  "favor",
  "hola",
  "sirve",
  "sirva",
  "usar",
  "como",
  "cual",
  "cuales",
  "donde",
  "producto",
  "productos",
  "catalogo",
  "articulo",
  "articulos",
  "opciones",
  "cosas",
  "linea",
  "lineas",
]);

/** lowercase, sin acentos, solo letras/numeros, espacios colapsados. */
export function normalizeText(text: string): string {
  return (text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Singularizacion heuristica: "colores"→"color", "galones"→"galon",
 * "detergentes"→"detergente". Es aproximada a proposito — los tokens se usan
 * como substring (LIKE %token%), asi que un recorte de mas solo agrega recall.
 */
export function stemToken(token: string): string {
  if (token.length > 4 && token.endsWith("es")) {
    const base = token.slice(0, -2);
    if (/[rnldjz]$/.test(base)) return base;
    return token.slice(0, -1);
  }
  if (token.length > 3 && token.endsWith("s")) return token.slice(0, -1);
  return token;
}

/**
 * Convierte la frase del cliente en tokens de busqueda: normaliza, quita
 * stopwords, descarta tokens cortos (salvo con digito, p. ej. "4l") y
 * singulariza. "detergente para ropa de color" → ["detergente","ropa","color"].
 */
export function tokenizeQuery(query: string): string[] {
  const tokens = normalizeText(query)
    .split(" ")
    .filter((t) => t.length > 0 && !SPANISH_STOPWORDS.has(t))
    .filter((t) => t.length >= 3 || (t.length >= 2 && /\d/.test(t)))
    .map(stemToken);
  return [...new Set(tokens)];
}

/**
 * Sinonimos del dominio: palabras distintas con las que cliente y catalogo
 * nombran lo mismo. Mantener MINIMA — solo pares confirmados por el catalogo
 * real (las descripciones dicen "prendas", los clientes dicen "ropa").
 */
export const TOKEN_SYNONYMS: Record<string, string[]> = {
  ropa: ["prenda"],
  prenda: ["ropa"],
  autolavado: ["automotriz", "lavacoches", "lavacoch", "auto"],
  automotriz: ["autolavado", "lavacoches", "lavacoch", "auto"],
  auto: ["automotriz", "autolavado", "lavacoches", "lavacoch"],
  lavacoches: ["lavacoch", "automotriz", "autolavado"],
  lavacoch: ["lavacoches", "automotriz", "autolavado"],
};

/** Tokens de consulta que indican intencion automotriz / autolavado. */
export const AUTOMOTIVE_QUERY_TOKENS = new Set([
  "autolavado",
  "automotriz",
  "auto",
  "lavacoches",
  "lavacoch",
  "coche",
  "coches",
  "carro",
  "carros",
  "vehiculo",
  "vehiculos",
]);

/** Señales en catalogo que confirman producto automotriz. */
export const AUTOMOTIVE_CATALOG_SIGNALS = [
  "automotriz",
  "neumatico",
  "neumaticos",
  "pintura",
  "lavacoch",
  "lavacoches",
  "autolavado",
  "autolavados",
  "auto",
  "vehiculo",
  "coche",
  "carro",
];

/** "negra"→"negr", "blanco"→"blanc": unifica genero en adjetivos largos. */
function stripFinalVowel(token: string): string {
  return token.length >= 5 && /[aeo]$/.test(token) ? token.slice(0, -1) : token;
}

/** Igualdad de tokens tolerante a genero (negro/negra) y sinonimos del dominio. */
export function tokensMatch(a: string, b: string): boolean {
  if (a === b) return true;
  if (stripFinalVowel(a) === stripFinalVowel(b)) return true;
  return TOKEN_SYNONYMS[a]?.includes(b) ?? false;
}

/**
 * Patrones LIKE para el SQL de candidatos: cada token (recortado de genero
 * para cubrir negro/negra) mas sus sinonimos. Los tokens ya vienen sin
 * acentos ni comodines (normalizeText elimina % y _).
 */
export function buildLikePatterns(tokens: string[]): string[] {
  const parts = new Set<string>();
  for (const t of tokens) {
    parts.add(stripFinalVowel(t));
    for (const s of TOKEN_SYNONYMS[t] ?? []) parts.add(stripFinalVowel(s));
  }
  return [...parts].map((t) => `%${t}%`);
}

export interface ScorableProduct {
  name: string;
  description: string | null;
  sku: string | null;
  isAvailable: boolean;
  stock: number;
  categoryName?: string | null;
  groupKey?: string | null;
  /** Texto indexable desde metadata (useCases, tags, etc.). */
  metadataText?: string | null;
}

function searchableProductText(p: ScorableProduct): string {
  return [p.name, p.description, p.sku, p.categoryName, p.groupKey, p.metadataText]
    .filter(Boolean)
    .join(" ");
}

export function isAutomotiveQuery(tokens: string[]): boolean {
  return tokens.some((t) => AUTOMOTIVE_QUERY_TOKENS.has(t));
}

/** Bonus cuando la consulta es automotriz y el producto tiene señales de autolavado. */
export function automotiveRelevanceBoost(queryTokens: string[], p: ScorableProduct): number {
  if (!isAutomotiveQuery(queryTokens)) return 0;
  const text = normalizeText(searchableProductText(p));
  if (!text) return 0;
  let boost = 0;
  for (const signal of AUTOMOTIVE_CATALOG_SIGNALS) {
    if (text.includes(signal)) boost = Math.max(boost, 12);
  }
  const nameNorm = normalizeText(p.name);
  if (nameNorm.includes("almorol") || nameNorm.includes("sh alta espuma") || nameNorm.includes("sh con cera")) {
    boost = Math.max(boost, 8);
  }
  if (nameNorm.includes("cera liquida") || nameNorm.startsWith("cera ")) {
    boost = Math.max(boost, 6);
  }
  return boost;
}

/**
 * Score de relevancia. Señales (por token se toma el maximo, no se suman):
 * nombre exacto +100, SKU exacto +80, frase completa en name +30 / en
 * description +15; por token (via tokensMatch: tolerante a genero y
 * sinonimos): en name +10, prefijo en name +6, substring en name +4, en
 * description +5, substring en description +3, substring en sku +6; bonus de
 * cobertura 0-10; disponible con stock +1. Score 0 = sin coincidencia (se
 * descarta).
 */
export function scoreProduct(
  queryNorm: string,
  queryTokens: string[],
  p: ScorableProduct,
): number {
  const nameNorm = normalizeText(p.name);
  const descNorm = normalizeText(p.description ?? "");
  const skuNorm = normalizeText(p.sku ?? "");
  const metaNorm = normalizeText(p.metadataText ?? "");
  const nameTokens = nameNorm.split(" ").filter(Boolean).map(stemToken);
  const descTokens = descNorm.split(" ").filter(Boolean).map(stemToken);
  const metaTokens = metaNorm.split(" ").filter(Boolean).map(stemToken);

  let score = 0;
  if (queryNorm) {
    if (nameNorm === queryNorm) score += 100;
    if (skuNorm && skuNorm === queryNorm) score += 80;
    if (queryNorm.length >= 3) {
      if (nameNorm.includes(queryNorm)) score += 30;
      else if (descNorm.includes(queryNorm)) score += 15;
      else if (metaNorm.includes(queryNorm)) score += 12;
    }
  }

  let matched = 0;
  for (const token of queryTokens) {
    let nameScore = 0;
    if (nameTokens.some((t) => tokensMatch(token, t))) nameScore = 10;
    else if (nameTokens.some((t) => t.startsWith(token) || token.startsWith(t))) nameScore = 6;
    else if (nameNorm.includes(token)) nameScore = 4;

    let descScore = 0;
    if (descTokens.some((t) => tokensMatch(token, t))) descScore = 5;
    else if (descNorm.includes(token)) descScore = 3;

    let metaScore = 0;
    if (metaTokens.some((t) => tokensMatch(token, t))) metaScore = 5;
    else if (metaNorm.includes(token)) metaScore = 4;

    const skuScore = skuNorm.includes(token) ? 6 : 0;

    const tokenScore = Math.max(nameScore, descScore, metaScore, skuScore);
    if (tokenScore > 0) matched++;
    score += tokenScore;
  }

  if (queryTokens.length > 0 && matched > 0) {
    score += (matched / queryTokens.length) * 10;
  }
  score += automotiveRelevanceBoost(queryTokens, p);
  if (score > 0 && p.isAvailable && p.stock > 0) score += 1;
  return score;
}

// Copia de Back/shared/src/catalog-units.ts (extractPresentation /
// extractProductGroupKey) — mantener en sync; el Agent no depende de
// @glamouroso/shared.

export function extractPresentation(name: string): string | null {
  const upper = name.toUpperCase();
  const liters = upper.match(/\b(\d+(?:\.\d+)?)\s*LITROS?\b/);
  if (liters) return `${liters[1]}L`;
  const ml = upper.match(/\b(\d+(?:\.\d+)?)\s*ML\b/);
  if (ml) return `${ml[1]}ml`;
  const kg = upper.match(/\b(\d+(?:\.\d+)?)\s*(?:KG|KILOS?)\b/);
  if (kg) return `${kg[1]}kg`;
  return null;
}

export function extractProductGroupKey(name: string): string | null {
  const presentation = extractPresentation(name);
  let group = name.trim();
  if (presentation) {
    group = group
      .replace(new RegExp(`\\b${presentation.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i"), "")
      .replace(/\b\d+(?:\.\d+)?\s*(?:LITROS?|ML|KG|KILOS?|GAL(?:ONES?)?)\b/gi, "")
      .replace(/\s+/g, " ")
      .trim();
  }
  return group.length >= 3 ? group.slice(0, 80) : null;
}

/** Pesos de la busqueda hibrida (vector + heuristica), igual que FAQs. */
export const PRODUCT_VECTOR_WEIGHT = 0.7;
export const PRODUCT_HEURISTIC_WEIGHT = 0.3;

/**
 * Combina score vectorial (0-1) con heuristica de scoreProduct (escala ~0-100+).
 * Match exacto de nombre (>=100) o SKU (>=80) siempre gana: protege
 * resolveOrderItems y checkProductAvailability con limit 1.
 */
export function combineScores(vectorScore: number, heuristicScore: number): number {
  if (heuristicScore >= 100) return 1;
  if (heuristicScore >= 80) return 0.95;
  const h = Math.min(Math.max(heuristicScore, 0) / 100, 1);
  const v = Math.min(Math.max(vectorScore, 0), 1);
  return PRODUCT_VECTOR_WEIGHT * v + PRODUCT_HEURISTIC_WEIGHT * h;
}

/**
 * Diversifica los resultados por linea de producto: greedy por score con tope
 * de `maxPerGroup` presentaciones por grupo; si el limite no se llena, rellena
 * con los saltados (tambien por score). Evita que las 8 posiciones sean 8
 * presentaciones del mismo producto.
 */
export function diversifyByGroup<T>(
  hits: T[],
  getGroupKey: (h: T) => string,
  limit: number,
  maxPerGroup = 2,
): T[] {
  const picked: T[] = [];
  const skipped: T[] = [];
  const counts = new Map<string, number>();
  for (const hit of hits) {
    if (picked.length >= limit) break;
    const key = getGroupKey(hit);
    const count = counts.get(key) ?? 0;
    if (count >= maxPerGroup) {
      skipped.push(hit);
      continue;
    }
    counts.set(key, count + 1);
    picked.push(hit);
  }
  for (const hit of skipped) {
    if (picked.length >= limit) break;
    picked.push(hit);
  }
  return picked;
}
