import { randomUUID } from "node:crypto";
import type Postgres from "postgres";
import { getSql } from "../db.js";
import { businessDateStamp } from "../time.js";
import type { TenantContext } from "../tenant.js";
import { findOrCreateCustomerByPhone } from "./customers.js";
import { getActiveConversationId } from "./conversations.js";
import {
  createOrder,
  resolveOrderItems,
  type OrderItemInput,
  type PaymentMethod,
  type ResolvedOrderItem,
} from "./orders.js";

/** Estados de cotizacion (espejo de QuoteStatus en quote.model.ts). */
export const QUOTE_STATUS = {
  DRAFT: "draft",
  SENT: "sent",
  APPROVED: "approved",
  CONVERTED: "converted",
  EXPIRED: "expired",
  CANCELLED: "cancelled",
} as const;

export interface CreatedQuote {
  id: string;
  quoteNumber: string;
  status: string;
  items: ResolvedOrderItem[];
  subtotal: number;
  tax: number;
  total: number;
  validUntil: string;
}

/** Tipo del cliente transaccional que entrega `sql.begin`. */
type TxSql = Postgres.TransactionSql<Record<string, never>>;

/** Genera el siguiente quote_number del dia para la organizacion (COT-YYYYMMDD-NNNN). */
async function nextQuoteNumber(
  sql: TxSql,
  organizationId: string,
): Promise<string> {
  // Serializa la numeracion por organizacion (clave distinta a la de orders):
  // quotes tiene UNIQUE (organization_id, quote_number) y dos cotizaciones
  // concurrentes contarian lo mismo y chocarian con 23505.
  await sql`SELECT pg_advisory_xact_lock(hashtext(${organizationId + ":quotes"}))`;
  const prefix = `COT-${businessDateStamp()}`;
  const rows = await sql<{ count: string }[]>`
    SELECT COUNT(*)::int AS count
    FROM quotes
    WHERE organization_id = ${organizationId}
      AND quote_number ILIKE ${prefix + "%"}
  `;
  const count = Number(rows[0]?.count ?? 0);
  return `${prefix}-${String(count + 1).padStart(4, "0")}`;
}

/**
 * Crea una cotizacion (no requiere direccion; la cotizacion es informativa).
 * Resuelve precios segun el tier del cliente y guarda los items como JSONB.
 */
export async function createQuote(
  tenant: TenantContext,
  args: {
    items: OrderItemInput[];
    contactName?: string | null;
    taxRate?: number;
    validDays?: number;
    notes?: string | null;
  },
): Promise<{ ok: true; quote: CreatedQuote } | { ok: false; message: string }> {
  if (!tenant.customerPhone) {
    return { ok: false, message: "No tengo el telefono del cliente para la cotizacion." };
  }
  if (!args.items || args.items.length === 0) {
    return { ok: false, message: "La cotizacion no tiene productos." };
  }

  const customer = await findOrCreateCustomerByPhone(tenant, {
    phone: tenant.customerPhone,
    name: args.contactName,
  });

  const { resolved, unresolved } = await resolveOrderItems(
    tenant,
    args.items,
    customer.pricingTier,
  );
  if (resolved.length === 0) {
    return { ok: false, message: `No pude encontrar en el catalogo: ${unresolved.join(", ")}.` };
  }

  const subtotal = resolved.reduce((sum, i) => sum + Number(i.total), 0);
  const taxRate = Number(args.taxRate ?? 0);
  const tax = Math.round(subtotal * (taxRate / 100) * 100) / 100;
  const total = subtotal + tax;

  const validUntil = new Date();
  validUntil.setDate(validUntil.getDate() + (Number(args.validDays) || 7));

  const sql = getSql();
  const conversationId = await getActiveConversationId(tenant, tenant.customerPhone);

  // Transaccion: el advisory lock de la numeracion es xact-scoped.
  const row = await sql.begin(async (tx) => {
    const quoteNumber = await nextQuoteNumber(tx, tenant.organizationId);
    const rows = await tx<
      { id: string; quote_number: string; status: string; valid_until: string }[]
    >`
      INSERT INTO quotes (
        id, organization_id, customer_id, conversation_id, quote_number, status,
        items, subtotal, tax, tax_rate, total, valid_until, notes
      ) VALUES (
        ${randomUUID()}, ${tenant.organizationId}, ${customer.id}, ${conversationId}, ${quoteNumber}, ${QUOTE_STATUS.DRAFT},
        ${tx.json(resolved as unknown as Parameters<typeof tx.json>[0])}, ${subtotal}, ${tax}, ${taxRate}, ${total}, ${validUntil}, ${args.notes ?? null}
      )
      RETURNING id, quote_number, status, valid_until
    `;
    return rows[0]!;
  });

  return {
    ok: true,
    quote: {
      id: row.id,
      quoteNumber: row.quote_number,
      status: row.status,
      items: resolved,
      subtotal,
      tax,
      total,
      validUntil: String(row.valid_until),
    },
  };
}

/**
 * Convierte una cotizacion en pedido. Reaplica la regla de direccion obligatoria
 * (a traves de createOrder). Marca la cotizacion como convertida.
 */
export async function convertQuoteToOrder(
  tenant: TenantContext,
  args: {
    quoteNumber: string;
    deliveryAddress?: string | null;
    locationId?: string | null;
    contactName?: string | null;
    paymentMethod?: PaymentMethod | null;
    /** Clave de idempotencia (sesion+turno+input); evita duplicar en re-runs. */
    idempotencyKey?: string | null;
  },
): Promise<
  | { ok: true; orderNumber: string; orderId: string; total: number; replayed?: boolean }
  | { ok: false; needsAddress?: boolean; message: string }
> {
  const sql = getSql();
  const quoteRows = await sql<
    { id: string; status: string; items: unknown }[]
  >`
    SELECT id, status, items
    FROM quotes
    WHERE organization_id = ${tenant.organizationId}
      AND quote_number = ${args.quoteNumber}
    LIMIT 1
  `;
  const quote = quoteRows[0];
  if (!quote) {
    return { ok: false, message: `No encontre la cotizacion ${args.quoteNumber}.` };
  }
  if (quote.status === QUOTE_STATUS.CONVERTED) {
    return { ok: false, message: `La cotizacion ${args.quoteNumber} ya fue convertida en pedido.` };
  }

  const quoteItems = Array.isArray(quote.items)
    ? (quote.items as ResolvedOrderItem[])
    : [];
  if (quoteItems.length === 0) {
    return { ok: false, message: `La cotizacion ${args.quoteNumber} no tiene productos.` };
  }

  const items: OrderItemInput[] = quoteItems.map((i) => ({
    productId: i.productId,
    name: i.productName,
    quantity: i.quantity,
    notes: i.notes,
  }));

  const created = await createOrder(tenant, {
    items,
    deliveryAddress: args.deliveryAddress,
    locationId: args.locationId,
    contactName: args.contactName,
    paymentMethod: args.paymentMethod,
    idempotencyKey: args.idempotencyKey,
  });
  if (!created.ok) {
    return { ok: false, needsAddress: created.needsAddress, message: created.message };
  }

  await sql`
    UPDATE quotes
    SET status = ${QUOTE_STATUS.CONVERTED},
        converted_to_order_id = ${created.order.id},
        converted_at = now(),
        updated_at = now()
    WHERE organization_id = ${tenant.organizationId}
      AND id = ${quote.id}
  `;

  return {
    ok: true,
    orderNumber: created.order.orderNumber,
    orderId: created.order.id,
    total: created.order.total,
    replayed: created.replayed,
  };
}
