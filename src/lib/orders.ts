import { and, eq, sql } from "drizzle-orm";
import type { Db } from "@/db/drizzle";
import { orderItems, orders, products } from "@/db/schema";
import { keysetPage, type KeysetSort } from "./keyset";

/** A visitor's orders. They are per visitor and never cached (SPEC.md 6.5). */

export type OrderSummary = {
  id: number;
  status: string;
  totalCents: number;
  createdAt: string;
  itemCount: number;
  /** Titles of the first few items, for the list. */
  titles: string[];
};

export type OrderList = {
  orders: OrderSummary[];
  nextCursor: string | null;
  prevCursor: string | null;
};

/** The cursor carries Postgres's own text for created_at, which keeps the microseconds a Date drops. */
const NEWEST_FIRST: KeysetSort = {
  key: "newest",
  value: orders.createdAt,
  id: orders.id,
  cast: "timestamptz",
  direction: "DESC",
};

/** A visitor's orders, newest first, keyset paginated on (created_at, id). */
export async function listOrders(
  db: Db,
  visitorId: string,
  page: { after?: string; before?: string; limit?: number } = {},
): Promise<OrderList> {
  // Per-order subqueries, so they run only for the rows on this page.
  const itemCount = db
    .select({ n: sql`coalesce(sum(${orderItems.quantity}), 0)::int` })
    .from(orderItems)
    .where(eq(orderItems.orderId, orders.id));
  const firstTitles = db
    .select({ title: orderItems.title })
    .from(orderItems)
    .where(eq(orderItems.orderId, orders.id))
    .orderBy(orderItems.productId)
    .limit(3);

  const result = await keysetPage({ sort: NEWEST_FIRST, ...page, filters: eq(orders.visitorId, visitorId) }, (keyset) =>
    db
      .select({
        id: orders.id,
        status: orders.status,
        totalCents: orders.totalCents,
        createdAt: orders.createdAt,
        itemCount: sql<number>`${itemCount}`,
        titles: sql<string[]>`ARRAY${firstTitles}`,
        cursorValue: keyset.cursorValue,
      })
      .from(orders)
      .where(keyset.where)
      .orderBy(...keyset.orderBy)
      .limit(keyset.limit),
  );

  return {
    orders: result.rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
    nextCursor: result.nextCursor,
    prevCursor: result.prevCursor,
  };
}

export type OrderDetail = {
  id: number;
  status: string;
  totalCents: number;
  createdAt: string;
  shippingName: string;
  shippingAddress: string;
  items: Array<{
    productId: number;
    slug: string;
    imageUrl: string | null;
    title: string;
    quantity: number;
    unitPriceCents: number;
  }>;
};

/** One order, only if it belongs to this visitor. */
export async function getOrder(db: Db, visitorId: string, orderId: number): Promise<OrderDetail | null> {
  if (!Number.isSafeInteger(orderId) || orderId < 1) return null;
  // The two reads do not depend on each other, so they share one round trip's
  // wait. Each checks the visitor itself, so neither reads another visitor's order.
  const [[order], items] = await Promise.all([
    db
      .select({
        id: orders.id,
        status: orders.status,
        totalCents: orders.totalCents,
        createdAt: orders.createdAt,
        shippingName: orders.shippingName,
        shippingAddress: orders.shippingAddress,
      })
      .from(orders)
      .where(and(eq(orders.id, orderId), eq(orders.visitorId, visitorId))),
    db
      .select({
        productId: orderItems.productId,
        slug: products.slug,
        imageUrl: sql<string | null>`${products.imageUrls}[1]`,
        title: orderItems.title,
        quantity: orderItems.quantity,
        unitPriceCents: orderItems.unitPriceCents,
      })
      .from(orderItems)
      .innerJoin(orders, eq(orders.id, orderItems.orderId))
      .innerJoin(products, eq(products.id, orderItems.productId))
      .where(and(eq(orderItems.orderId, orderId), eq(orders.visitorId, visitorId)))
      .orderBy(orderItems.productId),
  ]);
  if (!order) return null;
  return { ...order, createdAt: order.createdAt.toISOString(), items };
}
