/**
 * Normalizacion de numeros de telefono para casar contra la base de datos.
 *
 * Kapso/WhatsApp entregan numeros en formato E.164 (p. ej. "+5215512345678"),
 * pero en la base pueden estar guardados con o sin "+", con espacios o guiones.
 * Generamos variantes candidatas para hacer match robusto.
 */

/** Deja solo digitos (sin "+", espacios ni signos). */
export function digitsOnly(raw: string): string {
  return (raw ?? "").replace(/[^\d]/g, "");
}

/** Ultimos 10 digitos (matching WhatsApp / customers.phone_normalized en Back). */
export function last10Digits(raw: string): string {
  return digitsOnly(raw).slice(-10);
}

/** Forma E.164 con "+" si trae digitos. */
export function toE164(raw: string): string {
  const d = digitsOnly(raw);
  return d ? `+${d}` : "";
}

/**
 * Normaliza un telefono al MISMO formato que guarda el Back en
 * `customers.phone_normalized` / `prospects.phone_normalized`:
 * `52` + 10 digitos (sin "+"). Replica `Back/src/utils/phone.util.ts`.
 */
export function normalizePhoneForDb(phone: string | null | undefined): string {
  const digits = String(phone || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 10) return `52${digits}`;
  if (digits.length === 12 && digits.startsWith("52")) return digits;
  if (digits.length === 13 && digits.startsWith("521")) return `52${digits.slice(3)}`;
  return digits;
}

/**
 * Variantes candidatas para buscar un numero en la DB.
 * Incluye E.164, solo digitos, y (para MX) el toggle del "1" tras el 52.
 */
export function phoneCandidates(raw: string): string[] {
  const d = digitsOnly(raw);
  if (!d) return [];

  const set = new Set<string>();
  set.add(d);
  set.add(`+${d}`);

  // Mexico: WhatsApp suele incluir el "1" (52 1 ...) que en DB puede faltar.
  if (d.startsWith("521") && d.length >= 12) {
    const without1 = `52${d.slice(3)}`;
    set.add(without1);
    set.add(`+${without1}`);
  } else if (d.startsWith("52") && d.length === 12) {
    const with1 = `521${d.slice(2)}`;
    set.add(with1);
    set.add(`+${with1}`);
  }

  return [...set];
}
