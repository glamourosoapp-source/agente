/**
 * Detección determinista de opt-out ("ya no me escribas") en mensajes
 * entrantes. Complementa a la tool `mark_do_not_contact` (criterio del LLM
 * para frases más ambiguas): esto atrapa las formas directas ANTES de gastar
 * un turno del agente, y protege el número registrando la exclusión aunque el
 * modelo no la detecte.
 *
 * Ojo con falsos positivos: "ahorita no", "luego te escribo", "hoy no puedo"
 * son aplazamientos, NO opt-outs, y no deben coincidir con estos patrones.
 */

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\w\sñ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const OPT_OUT_PATTERNS: RegExp[] = [
  // "ya no me escribas", "no nos manden mensajes", "no me vuelvas a escribir"…
  // Solo subjuntivo/imperativo/infinitivo (petición), no pasado ("no me escribiste" es queja).
  /\b(ya )?no (me|nos) (vuelvas? a |vuelvan a )?(escribas?|escriban|escribir|mandes|manden|mandar|molestes?|molesten|molestar|contactes?|contacten|contactar|marques|marquen|marcar|llames|llamen|llamar)\b/,
  // "deja de escribirme", "dejen de mandar mensajes"
  /\bdej(a|en) de (escribirme|escribirnos|escribir|mandarme|mandar|molestarme|molestar|contactarme|contactar|llamarme|llamar)\b/,
  // "quítame de la lista", "bórrenme de su lista"
  /\b(quitame|quitenme|borrame|borrenme|sacame|saquenme|eliminame|eliminenme) de (la|su|tu|esta) lista\b/,
  // "no quiero más mensajes/publicidad/promociones"
  /\bno quiero (mas |recibir )?(mensajes|publicidad|promociones|informacion|info)\b/,
  // palabras sueltas universales de baja
  /^(baja|stop|unsubscribe|alto)$/,
];

/** true si el mensaje es una petición explícita de no ser contactado. */
export function isOptOutMessage(text: string): boolean {
  const normalized = normalize(text || "");
  if (!normalized) return false;
  return OPT_OUT_PATTERNS.some((pattern) => pattern.test(normalized));
}

/** Despedida única y cortés tras registrar el opt-out. */
export function optOutFarewell(): string {
  return "Entendido, no te volveremos a escribir. Disculpa la molestia y gracias por tu tiempo. 🙏";
}
