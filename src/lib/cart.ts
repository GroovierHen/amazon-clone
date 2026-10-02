import { and, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@/db/drizzle";
import { cartItems, carts, products } from "@/db/schema";
import { MAX_LINE_QUANTITY, summarize, type Cart } from "./cart-lines";

/**
 * Cart reads and writes. A cart belongs to a visitor id from a cookie, not an
 * account. Nothing here touches stock: stock changes only when an order is
 * placed (SPEC.md 6.4). Nothing here is cached (SPEC.md 6.5).
 */

const isQuantity = (n: number) => Number.isSafeInteger(n) && n >= 1;
const isId = (n: number) => Number.isSafeInteger(n) && n >= 1;

export async function getCart(db: Db, visitorId: string): Promise<Cart> {
  const lines = await db
    .select({
      productId: products.id,
      slug: products.slug,
      title: products.title,
      imageUrl: sql<string | null>`${products.imageUrls}[1]`,
      priceCents: products.priceCents,
      stock: products.stock,
      quantity: cartItems.quantity,
    })
    .from(carts)
    .innerJoin(cartItems, eq(cartItems.cartId, carts.id))
    .innerJoin(products, eq(products.id, cartItems.productId))
    .where(eq(carts.visitorId, visitorId))
    .orderBy(cartItems.addedAt, products.id);
  return summarize(lines);
}

export async function getCartCount(db: Db, visitorId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`coalesce(sum(${cartItems.quantity}), 0)::int` })
    .from(carts)
    .innerJoin(cartItems, eq(cartItems.cartId, carts.id))
    .where(eq(carts.visitorId, visitorId));
  return row.count;
}

/**
 * Adds to a line, creating the cart and the line as needed, in one statement.
 * Returns false when the product does not exist or the input is not valid.
 */
export async function addToCart(db: Db, visitorId: string, productId: number, quantity = 1): Promise<boolean> {
  if (!isId(productId) || !isQuantity(quantity)) return false;
  const cart = db.$with("cart").as(
    db
      .insert(carts)
      .values({ visitorId })
      .onConflictDoUpdate({ target: carts.visitorId, set: { updatedAt: sql`now()` } })
      .returning({ id: carts.id }),
  );
  // Selecting from products means a product that does not exist adds no row.
  const result = await db
    .with(cart)
    .insert(cartItems)
    .select(
      db
        .select({
          cartId: cart.id,
          productId: products.id,
          quantity: sql<number>`${Math.min(quantity, MAX_LINE_QUANTITY)}::int`.as("quantity"),
          addedAt: sql<Date>`now()`.as("added_at"),
        })
        .from(cart)
        .crossJoin(products)
        .where(eq(products.id, productId)),
    )
    .onConflictDoUpdate({
      target: [cartItems.cartId, cartItems.productId],
      set: { quantity: sql`least(${cartItems.quantity} + excluded.quantity, ${MAX_LINE_QUANTITY}::int)` },
    });
  return (result.rowCount ?? 0) > 0;
}

/** Sets a line to an exact quantity. Zero or less removes the line. */
export async function setCartQuantity(db: Db, visitorId: string, productId: number, quantity: number): Promise<boolean> {
  if (!isId(productId) || !Number.isSafeInteger(quantity)) return false;
  if (quantity <= 0) return removeFromCart(db, visitorId, productId);
  const result = await db
    .update(cartItems)
    .set({ quantity: Math.min(quantity, MAX_LINE_QUANTITY) })
    .where(and(eq(cartItems.productId, productId), inArray(cartItems.cartId, cartOf(db, visitorId))));
  return (result.rowCount ?? 0) > 0;
}

export async function removeFromCart(db: Db, visitorId: string, productId: number): Promise<boolean> {
  if (!isId(productId)) return false;
  const result = await db
    .delete(cartItems)
    .where(and(eq(cartItems.productId, productId), inArray(cartItems.cartId, cartOf(db, visitorId))));
  return (result.rowCount ?? 0) > 0;
}

/** Subquery for the visitor's cart id, so a write can only reach their own lines. */
function cartOf(db: Db, visitorId: string) {
  return db.select({ id: carts.id }).from(carts).where(eq(carts.visitorId, visitorId));
}
