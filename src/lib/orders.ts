import { and, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@/db/drizzle";
import { cartItems, carts, orderItems, orders, products } from "@/db/schema";
import { keysetPage, type KeysetSort } from "./keyset";

/**
 * Placing an order is the only place stock changes (SPEC.md 6.4). Orders are
 * per visitor and are never cached (SPEC.md 6.5).
 */

export type Shipping = { name: string; address: string };

export type ShortItem = {
  productId: number;
  title: string;
  requested: number;
  /** How many are on the shelf right now. Zero means out of stock. */
  available: number;
};

export type PlaceOrderResult =
  | { ok: true; orderId: number; productIds: number[] }
  | { ok: false; reason: "empty" }
  | { ok: false; reason: "short"; shortItems: ShortItem[] };

type Refusal = Exclude<PlaceOrderResult, { ok: true }>;

/** Thrown inside the transaction: Drizzle rolls back, and the caller gets the reason. */
class OrderRefused extends Error {
  result: Refusal;
  constructor(result: Refusal) {
    super("Order refused");
    this.result = result;
  }
}

/**
 * One transaction, in the order SPEC.md 6.4 gives. If any item is short the
 * whole thing rolls back, so stock and the cart are left exactly as they were.
 */
export async function placeOrder(db: Db, visitorId: string, shipping: Shipping): Promise<PlaceOrderResult> {
  try {
    return await db.transaction(async (tx) => {
      // 1. Read the cart items. The cart row is locked first, so the same cart
      //    submitted twice at once produces one order: the second waits here and
      //    then finds the cart empty. The items are read in a separate statement
      //    on purpose. A statement that waited for the lock keeps its old snapshot
      //    for joined tables, and would still see the items the first order took.
      const [cart] = await tx.select({ id: carts.id }).from(carts).where(eq(carts.visitorId, visitorId)).for("update");
      const items = cart
        ? await tx
            .select({ productId: cartItems.productId, quantity: cartItems.quantity })
            .from(cartItems)
            .where(eq(cartItems.cartId, cart.id))
            .orderBy(cartItems.productId)
        : [];
      if (items.length === 0) throw new OrderRefused({ ok: false, reason: "empty" });
      const productIds = items.map((item) => item.productId);
      const quantities = items.map((item) => item.quantity);

      // 2. Lock the product rows in ascending id order. Every order takes its
      //    locks in the same order, so two carts that share products cannot
      //    deadlock; one simply waits for the other.
      const locked = await tx
        .select({ id: products.id, title: products.title, priceCents: products.priceCents, stock: products.stock })
        .from(products)
        .where(inArray(products.id, productIds))
        .orderBy(products.id)
        .for("update");
      const byId = new Map(locked.map((p) => [p.id, p]));

      // 3. Every quantity must fit within stock, or nothing happens.
      const shortItems: ShortItem[] = [];
      for (const item of items) {
        const product = byId.get(item.productId)!;
        if (item.quantity > product.stock) {
          shortItems.push({
            productId: product.id,
            title: product.title,
            requested: item.quantity,
            available: product.stock,
          });
        }
      }
      if (shortItems.length > 0) throw new OrderRefused({ ok: false, reason: "short", shortItems });

      // 4 to 6 run as one statement, in this order, so the product rows stay
      // locked for one round trip instead of four. The query builder has no way
      // to chain three writes in one statement, so this one is written as SQL.
      const totalCents = items.reduce((sum, item) => sum + item.quantity * byId.get(item.productId)!.priceCents, 0);
      const order = await tx.execute<{ id: number }>(sql`
        WITH line AS (
          SELECT x.id, x.quantity
          FROM unnest(${sql.param(productIds)}::bigint[], ${sql.param(quantities)}::int[]) AS x(id, quantity)
        ),
        -- 4. Decrement stock.
        decremented AS (
          UPDATE products p SET stock = p.stock - line.quantity FROM line WHERE p.id = line.id
        ),
        -- 5. Insert the order and its items, copying title and price from the product.
        new_order AS (
          INSERT INTO orders (visitor_id, status, total_cents, shipping_name, shipping_address)
          VALUES (${visitorId}, 'placed', ${totalCents}, ${shipping.name}, ${shipping.address})
          RETURNING id
        ),
        new_items AS (
          INSERT INTO order_items (order_id, product_id, quantity, title, unit_price_cents)
          SELECT new_order.id, p.id, line.quantity, p.title, p.price_cents
          FROM new_order, line JOIN products p ON p.id = line.id
        ),
        -- 6. Delete the cart items.
        emptied AS (
          DELETE FROM cart_items WHERE cart_id = ${cart.id}
        )
        SELECT id FROM new_order`);

      // 7. Commit: Drizzle commits when this callback returns.
      return { ok: true, orderId: order.rows[0].id, productIds };
    });
  } catch (error) {
    if (error instanceof OrderRefused) return error.result;
    throw error;
  }
}

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
