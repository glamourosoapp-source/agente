/**
 * Utilidades de fecha/hora para el negocio.
 *
 * Los pedidos/entregas se guardan como timestamp en Postgres. El modelo razona
 * en la zona horaria del negocio (GLAM_TIMEZONE, por defecto America/Mexico_City).
 * Aqui proveemos helpers para formatear y para describir "ahora" al modelo.
 */

export function businessTimezone(): string {
  return process.env.GLAM_TIMEZONE || "America/Mexico_City";
}

/** Fecha/hora actual formateada en la zona del negocio, para el prompt. */
export function nowInBusinessTz(): string {
  return new Intl.DateTimeFormat("es-MX", {
    timeZone: businessTimezone(),
    dateStyle: "full",
    timeStyle: "short",
  }).format(new Date());
}

/** Fecha YYYY-MM-DD de un Date en la zona del negocio. */
function isoDateInTz(date: Date, tz: string): string {
  // en-CA formatea como YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/**
 * Bloque de contexto temporal para inyectar en el prompt en cada turno.
 *
 * El modelo no conoce la fecha real (usa la de su entrenamiento), por eso aqui
 * le damos "hoy" y "manana" como fuente de verdad, con el dia de la semana y la
 * fecha ISO, para que interprete bien expresiones como "manana" o "el jueves".
 */
export function temporalContextMarkdown(): string {
  const tz = businessTimezone();
  const now = new Date();
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  const longDate = (d: Date): string =>
    new Intl.DateTimeFormat("es-MX", {
      timeZone: tz,
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(d);

  const time = new Intl.DateTimeFormat("es-MX", {
    timeZone: tz,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(now);

  return [
    "## Contexto temporal (fuente de verdad)",
    "",
    `- **Hoy** es ${longDate(now)} (${isoDateInTz(now, tz)}). Hora actual: ${time}.`,
    `- **Manana** es ${longDate(tomorrow)} (${isoDateInTz(tomorrow, tz)}).`,
    `- Zona horaria del negocio: ${tz}.`,
    "- Usa SIEMPRE esta fecha como \"hoy\". NO uses fechas ni anos de tu conocimiento previo.",
    "- Interpreta \"manana\", \"el jueves\", \"la proxima semana\", etc. a partir de **hoy**.",
    "- Antes de confirmar una fecha de entrega, verifica que el dia de la semana coincida con",
    "  el numero de dia (p. ej. no digas \"miercoles 18\" si el 18 es jueves) y que el ano sea correcto.",
  ].join("\n");
}

/** Formatea un Date/ISO para mostrarlo al cliente (es-MX, zona del negocio). */
export function formatForCustomer(value: Date | string): string {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("es-MX", {
    timeZone: businessTimezone(),
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

/**
 * Valida e interpreta un datetime ISO 8601. Si no trae offset, se asume que
 * esta expresado en la zona del negocio (no en UTC) y se deja tal cual para
 * que Postgres lo interprete con la zona de la conexion.
 */
export function parseIsoDateTime(input: string): Date {
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) {
    throw new Error(
      `Fecha/hora invalida: "${input}". Usa formato ISO 8601, p. ej. 2026-06-20T15:30:00.`,
    );
  }
  return date;
}
