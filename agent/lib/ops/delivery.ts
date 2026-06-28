import { getSql } from "../db.js";
import { businessTimezone } from "../time.js";
import type { TenantContext } from "../tenant.js";

/** Ventanas de entrega ofrecidas al cliente. */
export const DELIVERY_WINDOWS = [
  "09:00-13:00",
  "13:00-17:00",
  "17:00-20:00",
] as const;

export interface AvailableDate {
  date: string; // YYYY-MM-DD
  dayName: string; // legible es-MX
  available: boolean;
}

function isoDateInTz(date: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/**
 * Devuelve las proximas fechas de entrega disponibles (omite domingos), con el
 * nombre del dia en es-MX. No requiere acceso a BD; es una agenda deterministica.
 */
export function getAvailableDeliveryDates(daysAhead = 7): AvailableDate[] {
  const tz = businessTimezone();
  const dates: AvailableDate[] = [];
  const now = new Date();

  for (let i = 1; i <= daysAhead + 1 && dates.length < daysAhead; i++) {
    const date = new Date(now.getTime() + i * 24 * 60 * 60 * 1000);
    // Domingo no hay entregas.
    if (date.getDay() === 0) continue;
    dates.push({
      date: isoDateInTz(date, tz),
      dayName: new Intl.DateTimeFormat("es-MX", {
        timeZone: tz,
        weekday: "long",
        day: "numeric",
        month: "long",
      }).format(date),
      available: true,
    });
  }
  return dates;
}

/**
 * Agenda la entrega de un pedido: fija fecha (DATEONLY) y ventana horaria.
 * Valida que el pedido pertenezca a la organizacion. Rechaza domingos.
 */
export async function scheduleDelivery(
  tenant: TenantContext,
  args: { orderNumber: string; date: string; timeWindow?: string | null },
): Promise<
  | { ok: true; orderNumber: string; date: string; timeWindow: string | null }
  | { ok: false; message: string }
> {
  const date = String(args.date || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { ok: false, message: "La fecha debe tener formato YYYY-MM-DD." };
  }
  // getDay() sobre la fecha pura (UTC midnight) basta para detectar domingo.
  if (new Date(`${date}T12:00:00`).getDay() === 0) {
    return { ok: false, message: "Los domingos no hay entregas. Ofrece otra fecha." };
  }

  const timeWindow = args.timeWindow ? String(args.timeWindow).trim() : null;

  const sql = getSql();
  const rows = await sql<{ order_number: string }[]>`
    UPDATE orders
    SET scheduled_delivery_date = ${date},
        delivery_time_window = ${timeWindow},
        requested_delivery_at = ${new Date(`${date}T12:00:00`)},
        updated_at = now()
    WHERE organization_id = ${tenant.organizationId}
      AND order_number = ${args.orderNumber}
    RETURNING order_number
  `;
  const row = rows[0];
  if (!row) {
    return { ok: false, message: `No encontre el pedido ${args.orderNumber}.` };
  }
  return { ok: true, orderNumber: row.order_number, date, timeWindow };
}
