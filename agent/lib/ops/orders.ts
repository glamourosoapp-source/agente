import type Postgres from "postgres";
import { getSql } from "../db.js";
import { normalizePhoneForDb } from "../phone.js";
import type { TenantContext } from "../tenant.js";
import {
  findOrCreateCustomerByPhone,
  type CustomerRecord,
} from "./customers.js";
import { resolveDeliveryAddress } from "./customer-locations.js";
import { getProductById, searchProducts } from "./products.js";
import { getActiveConversationId } from "./conversations.js";
import { deliveryFeeFor } from "./shipping.js";

/** Formas de pago aceptadas por el agente. */
export const PAYMENT_METHODS = ["efectivo", "transferencia"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** Estados de pedido (espejo de ORDER_STATUS en shared/constants.ts). */
export const ORDER_STATUS = {
  NEW: "new",
  PROCESSING: "processing",
  DELIVERED: "delivered",
  CANCELLED: "cancelled",
} as const;

export interface OrderItemInput {
  productId?: string | null;
  name?: string | null;
  quantity: number;
  notes?: string | null;
}

export interface ResolvedOrderItem {
  productId: string | null;
  productName: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  total: number;
  notes: string | null;
}

export interface OrderSummary {
  items: ResolvedOrderItem[];
  subtotal: number;
  deliveryFee: number;
  discount: number;
  total: number;
  unresolved: string[];
}

/** Item pedido pero sin stock/disponibilidad suficiente. */
export interface UnavailableItem {
  productName: string;
  requested: number;
  stock: number;
  reason: "not_available" | "insufficient_stock";
}

/**
 * Si GLAM_ENFORCE_STOCK=true, ademas de la bandera is_available se exige que la
 * cantidad pedida quepa en el stock registrado. Apagado por defecto porque hay
 * catalogos que no llevan inventario (stock=0 = "no rastreado").
 */
function enforceStockQuantity(): boolean {
  return (process.env.GLAM_ENFORCE_STOCK || "").toLowerCase() === "true";
}

/** Precio unitario segun el tier del cliente (retail/wholesale). */
function unitPriceFor(
  pricingTier: string,
  price: number,
  wholesalePrice: number | null,
): number {
  if (pricingTier === "wholesale" && wholesalePrice && wholesalePrice > 0) {
    return wholesalePrice;
  }
  return price;
}

/**
 * Resuelve los items contra el catalogo (por id o por nombre), calculando
 * precios segun el tier del cliente. Items que no casan con ningun producto se
 * reportan en `unresolved` (no se agregan al pedido).
 */
export async function resolveOrderItems(
  tenant: TenantContext,
  items: OrderItemInput[],
  pricingTier: string,
): Promise<{
  resolved: ResolvedOrderItem[];
  unresolved: string[];
  unavailable: UnavailableItem[];
}> {
  const resolved: ResolvedOrderItem[] = [];
  const unresolved: string[] = [];
  const unavailable: UnavailableItem[] = [];

  for (const item of items) {
    const quantity = Number(item.quantity) || 0;
    if (quantity <= 0) {
      unresolved.push(item.name || item.productId || "(item sin cantidad)");
      continue;
    }

    let product = item.productId ? await getProductById(tenant, item.productId) : null;
    if (!product && item.name) {
      const hits = await searchProducts(tenant, item.name, {
        limit: 1,
        includeUnavailable: true,
      });
      product = hits[0] ?? null;
    }

    if (!product) {
      unresolved.push(item.name || item.productId || "(producto desconocido)");
      continue;
    }

    // Validacion de disponibilidad: nunca vender productos marcados como no
    // disponibles; el stock por cantidad solo se exige con GLAM_ENFORCE_STOCK.
    if (!product.isAvailable) {
      unavailable.push({
        productName: product.name,
        requested: quantity,
        stock: product.stock,
        reason: "not_available",
      });
      continue;
    }
    if (enforceStockQuantity() && quantity > product.stock) {
      unavailable.push({
        productName: product.name,
        requested: quantity,
        stock: product.stock,
        reason: "insufficient_stock",
      });
      continue;
    }

    const unitPrice = unitPriceFor(pricingTier, product.price, product.wholesalePrice);
    resolved.push({
      productId: product.id,
      productName: product.name,
      unit: product.unit,
      quantity,
      unitPrice,
      total: Math.round(unitPrice * quantity * 100) / 100,
      notes: item.notes ?? null,
    });
  }

  return { resolved, unresolved, unavailable };
}

function totals(items: ResolvedOrderItem[], deliveryFee = 0, discount = 0) {
  const subtotal = items.reduce((sum, i) => sum + Number(i.total), 0);
  const total = subtotal + Number(deliveryFee || 0) - Number(discount || 0);
  return { subtotal, total: Math.max(total, 0) };
}

/** Direccion efectiva del pedido: la provista, por locationId o la guardada del cliente. */
async function effectiveAddress(
  tenant: TenantContext,
  provided: string | null | undefined,
  customer: CustomerRecord,
  locationId?: string | null,
): Promise<string | null> {
  return resolveDeliveryAddress(customer, { deliveryAddress: provided, locationId }, tenant);
}

export interface PrepareOrderResult {
  ok: boolean;
  needsAddress?: boolean;
  unavailable?: UnavailableItem[];
  customer?: { id: string; name: string; phone: string; pricingTier: string };
  summary?: OrderSummary;
  deliveryAddress?: string | null;
  paymentMethod?: PaymentMethod | null;
  message?: string;
}

/**
 * Arma el resumen del pedido SIN persistir. Aplica la regla de direccion
 * obligatoria: si no hay direccion (provista ni guardada en el cliente),
 * devuelve `needsAddress: true` para que el agente la pida antes de confirmar.
 */
export async function prepareOrder(
  tenant: TenantContext,
  args: {
    items: OrderItemInput[];
    deliveryAddress?: string | null;
    locationId?: string | null;
    contactName?: string | null;
    paymentMethod?: PaymentMethod | null;
    deliveryFee?: number;
    discount?: number;
  },
): Promise<PrepareOrderResult> {
  if (!tenant.customerPhone) {
    return { ok: false, message: "No tengo el telefono del cliente para armar el pedido." };
  }
  if (!args.items || args.items.length === 0) {
    return { ok: false, message: "El pedido no tiene productos." };
  }

  const customer = await findOrCreateCustomerByPhone(tenant, {
    phone: tenant.customerPhone,
    name: args.contactName,
  });

  const address = await effectiveAddress(tenant, args.deliveryAddress, customer, args.locationId);
  if (!address) {
    return {
      ok: false,
      needsAddress: true,
      customer: {
        id: customer.id,
        name: customer.name,
        phone: customer.phone,
        pricingTier: customer.pricingTier,
      },
      message:
        "El pedido necesita una direccion de entrega. Pidela al cliente antes de continuar.",
    };
  }

  const { resolved, unresolved, unavailable } = await resolveOrderItems(
    tenant,
    args.items,
    customer.pricingTier,
  );

  // Productos agotados/no disponibles: no armar el pedido a medias; el agente
  // debe avisar al cliente y ofrecer alternativas o ajustar cantidades.
  if (unavailable.length > 0) {
    const detail = unavailable
      .map((u) =>
        u.reason === "not_available"
          ? `${u.productName} (no disponible)`
          : `${u.productName} (pediste ${u.requested}, hay ${u.stock})`,
      )
      .join(", ");
    return {
      ok: false,
      unavailable,
      message:
        `Estos productos no estan disponibles ahora mismo: ${detail}. ` +
        "Avisa al cliente y ofrece alternativas antes de continuar.",
    };
  }

  if (resolved.length === 0) {
    return {
      ok: false,
      message: `No pude encontrar en el catalogo: ${unresolved.join(", ")}.`,
    };
  }

  // Envio segun la politica del negocio (gratis desde GLAM_FREE_SHIPPING_MIN),
  // salvo que la tool pase un costo explicito.
  const subtotalOnly = resolved.reduce((sum, i) => sum + Number(i.total), 0);
  const deliveryFee = args.deliveryFee ?? deliveryFeeFor(subtotalOnly);

  const { subtotal, total } = totals(resolved, deliveryFee, args.discount);
  return {
    ok: true,
    customer: {
      id: customer.id,
      name: customer.name,
      phone: customer.phone,
      pricingTier: customer.pricingTier,
    },
    deliveryAddress: address,
    paymentMethod: args.paymentMethod ?? null,
    summary: {
      items: resolved,
      subtotal,
      deliveryFee: Number(deliveryFee || 0),
      discount: Number(args.discount || 0),
      total,
      unresolved,
    },
  };
}

export interface CreatedOrder {
  id: string;
  orderNumber: string;
  status: string;
  subtotal: number;
  total: number;
  deliveryAddress: string;
  items: ResolvedOrderItem[];
}

/** Tipo del cliente transaccional que entrega `sql.begin`. */
type TxSql = Postgres.TransactionSql<Record<string, never>>;

/** Genera el siguiente order_number del dia para la organizacion (ORD-YYYYMMDD-NNNN). */
async function nextOrderNumber(
  sql: TxSql,
  organizationId: string,
): Promise<string> {
  // Serializa la numeracion por organizacion dentro de la transaccion: dos
  // pedidos concurrentes del mismo dia contarian lo mismo y duplicarian folio.
  await sql`SELECT pg_advisory_xact_lock(hashtext(${organizationId}))`;
  const today = new Date();
  const prefix = `ORD-${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, "0")}${String(today.getDate()).padStart(2, "0")}`;
  const rows = await sql<{ count: string }[]>`
    SELECT COUNT(*)::int AS count
    FROM orders
    WHERE organization_id = ${organizationId}
      AND order_number ILIKE ${prefix + "%"}
  `;
  const count = Number(rows[0]?.count ?? 0);
  return `${prefix}-${String(count + 1).padStart(4, "0")}`;
}

/**
 * Busca un pedido ya creado con la misma clave de idempotencia (re-run de un
 * paso interrumpido). Devuelve la misma forma que un pedido recien creado.
 */
async function findOrderByIdempotencyKey(
  tenant: TenantContext,
  idempotencyKey: string,
): Promise<CreatedOrder | null> {
  const sql = getSql();
  const rows = await sql<
    {
      id: string;
      order_number: string;
      status: string;
      subtotal: string | number;
      total: string | number;
      delivery_address: string | null;
    }[]
  >`
    SELECT id, order_number, status, subtotal, total, delivery_address
    FROM orders
    WHERE organization_id = ${tenant.organizationId}
      AND idempotency_key = ${idempotencyKey}
    LIMIT 1
  `;
  const order = rows[0];
  if (!order) return null;

  const itemRows = await sql<
    {
      product_id: string | null;
      product_name: string;
      unit: string;
      quantity: string | number;
      unit_price: string | number;
      total: string | number;
      notes: string | null;
    }[]
  >`
    SELECT product_id, product_name, unit, quantity, unit_price, total, notes
    FROM order_items
    WHERE order_id = ${order.id}
    ORDER BY created_at ASC
  `;

  return {
    id: order.id,
    orderNumber: order.order_number,
    status: order.status,
    subtotal: Number(order.subtotal ?? 0),
    total: Number(order.total ?? 0),
    deliveryAddress: order.delivery_address ?? "",
    items: itemRows.map((i) => ({
      productId: i.product_id,
      productName: i.product_name,
      unit: i.unit,
      quantity: Number(i.quantity ?? 0),
      unitPrice: Number(i.unit_price ?? 0),
      total: Number(i.total ?? 0),
      notes: i.notes,
    })),
  };
}

/**
 * Persiste el pedido (cabecera + items) en una transaccion. Reaplica la regla de
 * direccion obligatoria. Devuelve el pedido creado. NO envia notificaciones: eso
 * lo dispara el puente al Back (syncOrderCreated) desde la tool.
 */
export async function createOrder(
  tenant: TenantContext,
  args: {
    items: OrderItemInput[];
    deliveryAddress?: string | null;
    locationId?: string | null;
    contactName?: string | null;
    customerNotes?: string | null;
    paymentMethod?: PaymentMethod | null;
    deliveryFee?: number;
    discount?: number;
    /** Clave de idempotencia (sesion+turno+input); evita duplicar en re-runs. */
    idempotencyKey?: string | null;
  },
): Promise<
  | { ok: true; order: CreatedOrder; replayed?: boolean }
  | {
      ok: false;
      needsAddress?: boolean;
      unavailable?: UnavailableItem[];
      message: string;
    }
> {
  // Re-run de un paso interrumpido: si esta clave ya creo un pedido, devolverlo
  // tal cual en vez de crear un duplicado.
  if (args.idempotencyKey) {
    const existing = await findOrderByIdempotencyKey(tenant, args.idempotencyKey);
    if (existing) return { ok: true, order: existing, replayed: true };
  }

  const prepared = await prepareOrder(tenant, {
    items: args.items,
    deliveryAddress: args.deliveryAddress,
    locationId: args.locationId,
    contactName: args.contactName,
    paymentMethod: args.paymentMethod,
    deliveryFee: args.deliveryFee,
    discount: args.discount,
  });
  if (!prepared.ok || !prepared.summary || !prepared.customer) {
    return {
      ok: false,
      needsAddress: prepared.needsAddress,
      unavailable: prepared.unavailable,
      message: prepared.message || "No se pudo preparar el pedido.",
    };
  }

  const sql = getSql();
  const conversationId = tenant.customerPhone
    ? await getActiveConversationId(tenant, tenant.customerPhone)
    : null;
  const summary = prepared.summary;
  const deliveryAddress = prepared.deliveryAddress!;
  const customerId = prepared.customer.id;

  let order: { id: string; order_number: string; status: string };
  try {
    order = await sql.begin(async (tx) => {
      const orderNumber = await nextOrderNumber(tx, tenant.organizationId);
      const headerRows = await tx<{ id: string; order_number: string; status: string }[]>`
        INSERT INTO orders (
          organization_id, customer_id, conversation_id, order_number, status,
          delivery_address, subtotal, delivery_fee, discount, total, customer_notes,
          payment_method, source, idempotency_key
        ) VALUES (
          ${tenant.organizationId}, ${customerId}, ${conversationId}, ${orderNumber}, ${ORDER_STATUS.NEW},
          ${deliveryAddress}, ${summary.subtotal}, ${summary.deliveryFee}, ${summary.discount},
          ${summary.total}, ${args.customerNotes ?? null},
          ${args.paymentMethod ?? null}, 'whatsapp', ${args.idempotencyKey ?? null}
        )
        RETURNING id, order_number, status
      `;
      const header = headerRows[0]!;

      for (const item of summary.items) {
        await tx`
          INSERT INTO order_items (
            order_id, product_id, product_name, unit, quantity, unit_price, total, notes
          ) VALUES (
            ${header.id}, ${item.productId}, ${item.productName}, ${item.unit},
            ${item.quantity}, ${item.unitPrice}, ${item.total}, ${item.notes}
          )
        `;
      }

      return header;
    });
  } catch (err) {
    // Violacion del unique (organization_id, idempotency_key): otro proceso
    // gano la carrera con la misma clave; devolver ese pedido.
    if (
      args.idempotencyKey &&
      (err as { code?: string })?.code === "23505"
    ) {
      const existing = await findOrderByIdempotencyKey(tenant, args.idempotencyKey);
      if (existing) return { ok: true, order: existing, replayed: true };
    }
    throw err;
  }

  return {
    ok: true,
    order: {
      id: order.id,
      orderNumber: order.order_number,
      status: order.status,
      subtotal: summary.subtotal,
      total: summary.total,
      deliveryAddress,
      items: summary.items,
    },
  };
}

export interface OrderStatusInfo {
  id: string;
  orderNumber: string;
  status: string;
  paymentStatus: string | null;
  total: number;
  deliveryAddress: string | null;
  scheduledDeliveryDate: string | null;
  deliveryTimeWindow: string | null;
  createdAt: string;
}

/** Consulta el estado de un pedido por numero, o el ultimo del cliente. */
export async function getOrderStatus(
  tenant: TenantContext,
  args: { orderNumber?: string },
): Promise<OrderStatusInfo | null> {
  const sql = getSql();

  interface Row {
    id: string;
    order_number: string;
    status: string;
    payment_status: string | null;
    total: string | number;
    delivery_address: string | null;
    scheduled_delivery_date: string | null;
    delivery_time_window: string | null;
    created_at: string;
  }

  let rows: Row[];
  if (args.orderNumber) {
    rows = await sql<Row[]>`
      SELECT id, order_number, status, payment_status, total, delivery_address,
             scheduled_delivery_date, delivery_time_window, created_at
      FROM orders
      WHERE organization_id = ${tenant.organizationId}
        AND order_number = ${args.orderNumber}
      LIMIT 1
    `;
  } else if (tenant.customerPhone) {
    rows = await sql<Row[]>`
      SELECT o.id, o.order_number, o.status, o.payment_status, o.total, o.delivery_address,
             o.scheduled_delivery_date, o.delivery_time_window, o.created_at
      FROM orders o
      JOIN customers c ON c.id = o.customer_id
      WHERE o.organization_id = ${tenant.organizationId}
        AND c.organization_id = ${tenant.organizationId}
        AND c.phone_normalized = ${normalizePhoneForDb(tenant.customerPhone)}
      ORDER BY o.created_at DESC
      LIMIT 1
    `;
  } else {
    return null;
  }

  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    orderNumber: row.order_number,
    status: row.status,
    paymentStatus: row.payment_status,
    total: Number(row.total ?? 0),
    deliveryAddress: row.delivery_address,
    scheduledDeliveryDate: row.scheduled_delivery_date,
    deliveryTimeWindow: row.delivery_time_window,
    createdAt: String(row.created_at),
  };
}

export interface OrderSummaryRow {
  orderNumber: string;
  status: string;
  total: number;
  itemCount: number;
  createdAt: string;
}

/**
 * Lista los pedidos anteriores del cliente actual (por su telefono), del mas
 * reciente al mas antiguo. Para "mis pedidos" / historial.
 */
export async function listOrders(
  tenant: TenantContext,
  args: { limit?: number } = {},
): Promise<OrderSummaryRow[]> {
  if (!tenant.customerPhone) return [];
  const sql = getSql();
  const limit = Math.min(Math.max(args.limit ?? 5, 1), 20);

  const rows = await sql<
    {
      order_number: string;
      status: string;
      total: string | number;
      item_count: string | number;
      created_at: string;
    }[]
  >`
    SELECT o.order_number, o.status, o.total, o.created_at,
           COUNT(oi.id)::int AS item_count
    FROM orders o
    JOIN customers c ON c.id = o.customer_id
    LEFT JOIN order_items oi ON oi.order_id = o.id
    WHERE o.organization_id = ${tenant.organizationId}
      AND c.organization_id = ${tenant.organizationId}
      AND c.phone_normalized = ${normalizePhoneForDb(tenant.customerPhone)}
    GROUP BY o.id
    ORDER BY o.created_at DESC
    LIMIT ${limit}
  `;

  return rows.map((r) => ({
    orderNumber: r.order_number,
    status: r.status,
    total: Number(r.total ?? 0),
    itemCount: Number(r.item_count ?? 0),
    createdAt: String(r.created_at),
  }));
}

/**
 * Cancela un pedido del cliente actual. Politica: SOLO se cancela si el pedido
 * esta en estado `new` (recien creado) y pertenece al telefono del cliente. Si
 * ya esta en proceso/entregado/cancelado, no se cancela (deriva a un humano).
 */
export async function cancelOrder(
  tenant: TenantContext,
  args: { orderNumber: string },
): Promise<
  | { ok: true; orderNumber: string }
  | { ok: false; reason: "not_found" | "not_cancellable"; status?: string; message: string }
> {
  if (!tenant.customerPhone) {
    return { ok: false, reason: "not_found", message: "No tengo el telefono del cliente." };
  }
  const sql = getSql();

  // Verifica que el pedido exista, sea del cliente y este en estado cancelable.
  const rows = await sql<{ id: string; status: string }[]>`
    SELECT o.id, o.status
    FROM orders o
    JOIN customers c ON c.id = o.customer_id
    WHERE o.organization_id = ${tenant.organizationId}
      AND c.organization_id = ${tenant.organizationId}
      AND c.phone_normalized = ${normalizePhoneForDb(tenant.customerPhone)}
      AND o.order_number = ${args.orderNumber}
    LIMIT 1
  `;
  const order = rows[0];
  if (!order) {
    return {
      ok: false,
      reason: "not_found",
      message: `No encontre el pedido ${args.orderNumber} a nombre de este cliente.`,
    };
  }
  if (order.status !== ORDER_STATUS.NEW) {
    return {
      ok: false,
      reason: "not_cancellable",
      status: order.status,
      message:
        `El pedido ${args.orderNumber} ya esta en estado "${order.status}" y no se puede ` +
        "cancelar automaticamente. Deriva a una persona del equipo.",
    };
  }

  await sql`
    UPDATE orders
    SET status = ${ORDER_STATUS.CANCELLED}, cancelled_at = now(), updated_at = now()
    WHERE organization_id = ${tenant.organizationId}
      AND id = ${order.id}
  `;
  return { ok: true, orderNumber: args.orderNumber };
}
