import type { Pool } from "pg";

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

/**
 * One transaction, in the order SPEC.md 6.4 gives. If any item is short the
 * whole thing rolls back, so stock and the cart are left exactly as they were.
 */
export async function placeOrder(pool: Pool, visitorId: string, shipping: Shipping): Promise<PlaceOrderResult> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 1. Read the cart items. The cart row is locked first, so the same cart
    //    submitted twice at once produces one order: the second waits here and
    //    then finds the cart empty. The items are read in a separate statement
    //    on purpose. A statement that waited for the lock keeps its old snapshot
    //    for joined tables, and would still see the items the first order took.
    const cart = await client.query<{ id: string }>("SELECT id FROM carts WHERE visitor_id = $1 FOR UPDATE", [
      visitorId,
    ]);
    const items = cart.rows[0]
      ? (
          await client.query<{ product_id: number; quantity: number }>(
            "SELECT product_id, quantity FROM cart_items WHERE cart_id = $1 ORDER BY product_id",
            [cart.rows[0].id],
          )
        ).rows
      : [];
    if (items.length === 0) {
      await client.query("ROLLBACK");
      return { ok: false, reason: "empty" };
    }
    const cartId = cart.rows[0].id;
    const productIds = items.map((item) => item.product_id);
    const quantities = items.map((item) => item.quantity);

    // 2. Lock the product rows in ascending id order. Every order takes its
    //    locks in the same order, so two carts that share products cannot
    //    deadlock; one simply waits for the other.
    const products = await client.query<{ id: number; title: string; price_cents: number; stock: number }>(
      "SELECT id, title, price_cents, stock FROM products WHERE id = ANY($1::bigint[]) ORDER BY id FOR UPDATE",
      [productIds],
    );
    const byId = new Map(products.rows.map((p) => [p.id, p]));

    // 3. Every quantity must fit within stock, or nothing happens.
    const shortItems: ShortItem[] = [];
    for (const item of items) {
      const product = byId.get(item.product_id)!;
      if (item.quantity > product.stock) {
        shortItems.push({
          productId: product.id,
          title: product.title,
          requested: item.quantity,
          available: product.stock,
        });
      }
    }
    if (shortItems.length > 0) {
      await client.query("ROLLBACK");
      return { ok: false, reason: "short", shortItems };
    }

    // 4 to 6 run as one statement, in this order, so the product rows stay
    // locked for one round trip instead of four.
    const totalCents = items.reduce((sum, item) => sum + item.quantity * byId.get(item.product_id)!.price_cents, 0);
    const order = await client.query<{ id: number }>(
      `WITH line AS (
         SELECT x.id, x.quantity FROM unnest($5::bigint[], $6::int[]) AS x(id, quantity)
       ),
       -- 4. Decrement stock.
       decremented AS (
         UPDATE products p SET stock = p.stock - line.quantity FROM line WHERE p.id = line.id
       ),
       -- 5. Insert the order and its items, copying title and price from the product.
       new_order AS (
         INSERT INTO orders (visitor_id, status, total_cents, shipping_name, shipping_address)
         VALUES ($1, 'placed', $2, $3, $4)
         RETURNING id
       ),
       new_items AS (
         INSERT INTO order_items (order_id, product_id, quantity, title, unit_price_cents)
         SELECT new_order.id, p.id, line.quantity, p.title, p.price_cents
         FROM new_order, line JOIN products p ON p.id = line.id
       ),
       -- 6. Delete the cart items.
       emptied AS (
         DELETE FROM cart_items WHERE cart_id = $7
       )
       SELECT id FROM new_order`,
      [visitorId, totalCents, shipping.name, shipping.address, productIds, quantities, cartId],
    );
    const orderId = order.rows[0].id;

    // 7. Commit.
    await client.query("COMMIT");
    return { ok: true, orderId, productIds };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export const ORDERS_PAGE_SIZE = 24;

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

function encodeOrderCursor(createdAt: string, id: number): string {
  return Buffer.from(JSON.stringify([createdAt, id])).toString("base64url");
}

function decodeOrderCursor(cursor: string | undefined): [string, number] | null {
  if (!cursor) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (!Array.isArray(parsed) || parsed.length !== 2) return null;
    const [createdAt, id] = parsed;
    if (typeof createdAt !== "string" || !/^[\d\-:.+ ]+$/.test(createdAt)) return null;
    if (typeof id !== "number" || !Number.isSafeInteger(id) || id < 0) return null;
    return [createdAt, id];
  } catch {
    return null;
  }
}

/** A visitor's orders, newest first, keyset paginated on (created_at, id). */
export async function listOrders(
  pool: Pool,
  visitorId: string,
  page: { after?: string; before?: string; limit?: number } = {},
): Promise<OrderList> {
  const limit = Math.min(Math.max(page.limit ?? ORDERS_PAGE_SIZE, 1), ORDERS_PAGE_SIZE);
  const after = decodeOrderCursor(page.after);
  const before = after ? null : decodeOrderCursor(page.before);
  const cursor = after ?? before;
  const backwards = before !== null;

  const values: unknown[] = [visitorId];
  let where = "";
  if (cursor) {
    values.push(cursor[0], cursor[1]);
    where = `AND (o.created_at, o.id) ${backwards ? ">" : "<"} ($2::timestamptz, $3::bigint)`;
  }
  values.push(limit + 1);
  const order = backwards ? "ASC" : "DESC";

  const { rows } = await pool.query<{
    id: number;
    status: string;
    total_cents: number;
    created_at: Date;
    cursor_value: string;
    item_count: number;
    titles: string[];
  }>(
    `SELECT o.id, o.status, o.total_cents, o.created_at, o.created_at::text AS cursor_value,
            (SELECT coalesce(sum(oi.quantity), 0)::int FROM order_items oi WHERE oi.order_id = o.id) AS item_count,
            ARRAY(SELECT oi.title FROM order_items oi WHERE oi.order_id = o.id ORDER BY oi.product_id LIMIT 3) AS titles
     FROM orders o
     WHERE o.visitor_id = $1 ${where}
     ORDER BY o.created_at ${order}, o.id ${order}
     LIMIT $${values.length}`,
    values,
  );

  const hasMore = rows.length > limit;
  const pageRows = rows.slice(0, limit);
  if (backwards) pageRows.reverse();
  const first = pageRows[0];
  const last = pageRows[pageRows.length - 1];
  const hasNext = backwards ? pageRows.length > 0 : hasMore;
  const hasPrev = backwards ? hasMore : after !== null && pageRows.length > 0;

  return {
    orders: pageRows.map((r) => ({
      id: r.id,
      status: r.status,
      totalCents: r.total_cents,
      createdAt: r.created_at.toISOString(),
      itemCount: r.item_count,
      titles: r.titles,
    })),
    nextCursor: hasNext && last ? encodeOrderCursor(last.cursor_value, last.id) : null,
    prevCursor: hasPrev && first ? encodeOrderCursor(first.cursor_value, first.id) : null,
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
export async function getOrder(pool: Pool, visitorId: string, orderId: number): Promise<OrderDetail | null> {
  if (!Number.isSafeInteger(orderId) || orderId < 1) return null;
  const order = await pool.query<{
    id: number;
    status: string;
    total_cents: number;
    created_at: Date;
    shipping_name: string;
    shipping_address: string;
  }>(
    `SELECT id, status, total_cents, created_at, shipping_name, shipping_address
     FROM orders WHERE id = $1 AND visitor_id = $2`,
    [orderId, visitorId],
  );
  const o = order.rows[0];
  if (!o) return null;
  const items = await pool.query<{
    product_id: number;
    slug: string;
    image_url: string | null;
    title: string;
    quantity: number;
    unit_price_cents: number;
  }>(
    `SELECT oi.product_id, p.slug, p.image_urls[1] AS image_url, oi.title, oi.quantity, oi.unit_price_cents
     FROM order_items oi JOIN products p ON p.id = oi.product_id
     WHERE oi.order_id = $1
     ORDER BY oi.product_id`,
    [orderId],
  );
  return {
    id: o.id,
    status: o.status,
    totalCents: o.total_cents,
    createdAt: o.created_at.toISOString(),
    shippingName: o.shipping_name,
    shippingAddress: o.shipping_address,
    items: items.rows.map((r) => ({
      productId: r.product_id,
      slug: r.slug,
      imageUrl: r.image_url,
      title: r.title,
      quantity: r.quantity,
      unitPriceCents: r.unit_price_cents,
    })),
  };
}
