import { getSql } from "../db.js";
import { businessTimezone } from "../time.js";
import {
  computeScheduledDeliveryDate,
  resolveDeliveryScheduleConfig,
  type DeliveryScheduleConfig,
} from "../delivery-schedule.js";
import type { TenantContext } from "../tenant.js";

/** Ventanas de entrega ofrecidas al cliente. */
export const DELIVERY_WINDOWS = [
  "09:00-13:00",
  "13:00-17:00",
  "17:00-20:00",
] as const;

/**
 * Lee la regla de agendamiento (hora de corte, desfases, timezone) de
 * organizations.brand_settings.delivery. Si la organizacion no define
 * timezone, cae a la del negocio (GLAM_TIMEZONE).
 */
export async function getDeliveryScheduleConfig(
  tenant: TenantContext,
): Promise<DeliveryScheduleConfig> {
  const sql = getSql();
  const rows = await sql<{ brand_settings: Record<string, unknown> | null }[]>`
    SELECT brand_settings FROM organizations WHERE id = ${tenant.organizationId}
  `;
  const raw = rows[0]?.brand_settings?.delivery;
  const cfg = resolveDeliveryScheduleConfig(raw);
  const hasTimezone =
    raw && typeof raw === "object" && typeof (raw as Record<string, unknown>).timezone === "string";
  if (!hasTimezone) cfg.timezone = businessTimezone();
  return cfg;
}

function dayNameInTz(date: string, tz: string): string {
  return new Intl.DateTimeFormat("es-MX", {
    timeZone: tz,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date(`${date}T12:00:00`));
}

/**
 * Fecha de entrega que el negocio asigna a un pedido recibido AHORA, segun la
 * regla de corte configurada. La fecha no se negocia con el cliente.
 */
export async function getAssignedDeliveryDate(
  tenant: TenantContext,
): Promise<{ date: string; dayName: string; timeWindows: readonly string[] }> {
  const cfg = await getDeliveryScheduleConfig(tenant);
  const date = computeScheduledDeliveryDate(new Date(), cfg);
  return { date, dayName: dayNameInTz(date, cfg.timezone), timeWindows: DELIVERY_WINDOWS };
}

/**
 * Registra la ventana horaria preferida del cliente para su pedido. La FECHA la
 * asigna el sistema al crear el pedido y no se cambia aqui; si el pedido no
 * tiene fecha (legacy), se calcula con la regla de corte.
 */
export async function scheduleDelivery(
  tenant: TenantContext,
  args: { orderNumber: string; timeWindow?: string | null },
): Promise<
  | { ok: true; orderNumber: string; date: string; dayName: string; timeWindow: string | null }
  | { ok: false; message: string }
> {
  const timeWindow = args.timeWindow ? String(args.timeWindow).trim() : null;
  const sql = getSql();

  const rows = await sql<{ order_number: string; scheduled_delivery_date: string | null }[]>`
    SELECT order_number, scheduled_delivery_date::text
    FROM orders
    WHERE organization_id = ${tenant.organizationId}
      AND order_number = ${args.orderNumber}
    LIMIT 1
  `;
  const order = rows[0];
  if (!order) {
    return { ok: false, message: `No encontre el pedido ${args.orderNumber}.` };
  }

  const cfg = await getDeliveryScheduleConfig(tenant);
  const date =
    order.scheduled_delivery_date || computeScheduledDeliveryDate(new Date(), cfg);

  await sql`
    UPDATE orders
    SET scheduled_delivery_date = ${date},
        delivery_time_window = ${timeWindow},
        requested_delivery_at = ${new Date(`${date}T12:00:00`)},
        updated_at = now()
    WHERE organization_id = ${tenant.organizationId}
      AND order_number = ${args.orderNumber}
  `;
  return {
    ok: true,
    orderNumber: order.order_number,
    date,
    dayName: dayNameInTz(date, cfg.timezone),
    timeWindow,
  };
}
