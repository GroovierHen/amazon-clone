import type { Pool } from "pg";

/**
 * Cart reads and writes. A cart belongs to a visitor id from a cookie, not an
 * account. Nothing here touches stock: stock changes only when an order is
 * placed (SPEC.md 6.4). Nothing here is cached (SPEC.md 6.5).
 */

/** Upper bound on one line, so a cart cannot hold absurd numbers. */
export const MAX_LINE_QUANTITY = 99;

export type CartLine = {
  productId: number;
  slug: string;
  title: string;
  imageUrl: string | null;
  /** The product's price right now. It is fixed only when the order is placed. */
  priceCents: number;
  stock: number;
  quantity: number;
};

export type Cart = {
  lines: CartLine[];
  count: number;
  subtotalCents: number;
};

export function summarize(lines: CartLine[]): Cart {
  return {
    lines,
    count: lines.reduce((sum, line) => sum + line.quantity, 0),
    subtotalCents: lines.reduce((sum, line) => sum + line.quantity * line.priceCents, 0),
  };
}

const isQuantity = (n: number) => Number.isSafeInteger(n) && n >= 1;
const isId = (n: number) => Number.isSafeInteger(n) && n >= 1;

export async function getCart(pool: Pool, visitorId: string): Promise<Cart> {
  const { rows } = await pool.query<{
    product_id: number;
    slug: string;
    title: string;
    image_url: string | null;
    price_cents: number;
    stock: number;
    quantity: number;
  }>(
    `SELECT p.id AS product_id, p.slug, p.title, p.image_urls[1] AS image_url,
            p.price_cents, p.stock, ci.quantity
     FROM carts c
     JOIN cart_items ci ON ci.cart_id = c.id
     JOIN products p ON p.id = ci.product_id
     WHERE c.visitor_id = $1
     ORDER BY ci.added_at, p.id`,
    [visitorId],
  );
  return summarize(
    rows.map((r) => ({
      productId: r.product_id,
      slug: r.slug,
      title: r.title,
      imageUrl: r.image_url,
      priceCents: r.price_cents,
      stock: r.stock,
      quantity: r.quantity,
    })),
  );
}

export async function getCartCount(pool: Pool, visitorId: string): Promise<number> {
  const { rows } = await pool.query<{ count: number }>(
    `SELECT coalesce(sum(ci.quantity), 0)::int AS count
     FROM carts c JOIN cart_items ci ON ci.cart_id = c.id
     WHERE c.visitor_id = $1`,
    [visitorId],
  );
  return rows[0].count;
}

/**
 * Adds to a line, creating the cart and the line as needed.
 * Returns false when the product does not exist or the input is not valid.
 */
export async function addToCart(pool: Pool, visitorId: string, productId: number, quantity = 1): Promise<boolean> {
  if (!isId(productId) || !isQuantity(quantity)) return false;
  const { rowCount } = await pool.query(
    `WITH cart AS (
       INSERT INTO carts (visitor_id) VALUES ($1)
       ON CONFLICT (visitor_id) DO UPDATE SET updated_at = now()
       RETURNING id
     )
     INSERT INTO cart_items (cart_id, product_id, quantity)
     SELECT cart.id, p.id, LEAST($3::int, $4::int)
     FROM cart, products p
     WHERE p.id = $2
     ON CONFLICT (cart_id, product_id)
     DO UPDATE SET quantity = LEAST(cart_items.quantity + EXCLUDED.quantity, $4::int)`,
    [visitorId, productId, quantity, MAX_LINE_QUANTITY],
  );
  return (rowCount ?? 0) > 0;
}

/** Sets a line to an exact quantity. Zero or less removes the line. */
export async function setCartQuantity(
  pool: Pool,
  visitorId: string,
  productId: number,
  quantity: number,
): Promise<boolean> {
  if (!isId(productId) || !Number.isSafeInteger(quantity)) return false;
  if (quantity <= 0) return removeFromCart(pool, visitorId, productId);
  const { rowCount } = await pool.query(
    `UPDATE cart_items ci
     SET quantity = LEAST($3::int, $4::int)
     FROM carts c
     WHERE c.id = ci.cart_id AND c.visitor_id = $1 AND ci.product_id = $2`,
    [visitorId, productId, quantity, MAX_LINE_QUANTITY],
  );
  return (rowCount ?? 0) > 0;
}

export async function removeFromCart(pool: Pool, visitorId: string, productId: number): Promise<boolean> {
  if (!isId(productId)) return false;
  const { rowCount } = await pool.query(
    `DELETE FROM cart_items ci
     USING carts c
     WHERE c.id = ci.cart_id AND c.visitor_id = $1 AND ci.product_id = $2`,
    [visitorId, productId],
  );
  return (rowCount ?? 0) > 0;
}
