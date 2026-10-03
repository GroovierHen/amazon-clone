import { eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@/db/drizzle";
import { cartItems, carts, products } from "@/db/schema";

/**
 * Checkout: the visitor's cart and shipping details become a placed order, or
 * the reason one was not placed. Placing an order is the only place stock
 * changes (SPEC.md 6.4).
 */

export const SHIPPING_FIELDS = ["name", "street", "city", "postcode"] as const;

export type ShippingField = (typeof SHIPPING_FIELDS)[number];

/** The shipping fields as stored: trimmed, with each run of whitespace made one space. */
export type ShippingValues = Record<ShippingField, string>;

export type ShortItem = {
  productId: number;
  title: string;
  requested: number;
  /** How many are on the shelf right now. Zero means out of stock. */
  available: number;
};

/** Every refusal carries the cleaned fields back, so a failed submit does not clear the form. */
export type CheckoutResult =
  | { status: "placed"; orderId: number }
  | { status: "invalid"; errors: Partial<Record<ShippingField, string>>; values: ShippingValues }
  | { status: "short"; shortItems: ShortItem[]; values: ShippingValues }
  | { status: "empty"; values: ShippingValues };

const LIMITS: Record<ShippingField, number> = { name: 100, street: 200, city: 100, postcode: 20 };
const REQUIRED: Record<ShippingField, string> = {
  name: "Enter the name of the person receiving the order.",
  street: "Enter a street address.",
  city: "Enter a town or city.",
  postcode: "Enter a postcode.",
};

/**
 * Checks the fields, then places the order. `stockChanged` is told which
 * products' cached pages now show the wrong stock: every product in a placed
 * order, after the commit, or the short items of a refused one. It is not
 * called for any other outcome, or when this throws, and its own failure is
 * logged rather than thrown.
 */
export async function checkout(
  db: Db,
  visitorId: string | null,
  fields: Partial<Record<ShippingField, unknown>>,
  stockChanged: (productIds: number[]) => void,
): Promise<CheckoutResult> {
  const values = {} as ShippingValues;
  const errors: Partial<Record<ShippingField, string>> = {};
  for (const field of SHIPPING_FIELDS) {
    const raw = fields[field];
    values[field] = typeof raw === "string" ? raw.trim().replace(/\s+/g, " ") : "";
    if (!values[field]) errors[field] = REQUIRED[field];
    else if (values[field].length > LIMITS[field]) errors[field] = `Use ${LIMITS[field]} characters or fewer.`;
  }
  if (Object.keys(errors).length > 0) return { status: "invalid", errors, values };
  if (!visitorId) return { status: "empty", values };

  const outcome = await placeOrder(db, visitorId, {
    name: values.name,
    address: `${values.street}\n${values.city} ${values.postcode}`,
  });
  switch (outcome.status) {
    case "placed":
      tellCache(stockChanged, outcome.productIds);
      return { status: "placed", orderId: outcome.orderId };
    case "short":
      tellCache(stockChanged, outcome.shortItems.map((item) => item.productId));
      return { status: "short", shortItems: outcome.shortItems, values };
    case "empty":
      return { status: "empty", values };
  }
}

/**
 * The transaction has already ended, so a cache failure is logged, not thrown:
 * the visitor must still learn what happened to their order. The pages fix
 * themselves when their short cache lifetime runs out.
 */
function tellCache(stockChanged: (productIds: number[]) => void, productIds: number[]): void {
  try {
    stockChanged(productIds);
  } catch (error) {
    console.error("stockChanged failed", error);
  }
}

type Shipping = { name: string; address: string };

type PlaceOrderOutcome =
  | { status: "placed"; orderId: number; productIds: number[] }
  | { status: "empty" }
  | { status: "short"; shortItems: ShortItem[] };

type Refusal = Exclude<PlaceOrderOutcome, { status: "placed" }>;

/** Thrown inside the transaction: Drizzle rolls back, and the caller gets the reason. */
class OrderRefused extends Error {
  outcome: Refusal;
  constructor(outcome: Refusal) {
    super("Order refused");
    this.outcome = outcome;
  }
}

/**
 * One transaction, in the order SPEC.md 6.4 gives. If any item is short the
 * whole thing rolls back, so stock and the cart are left exactly as they were.
 */
async function placeOrder(db: Db, visitorId: string, shipping: Shipping): Promise<PlaceOrderOutcome> {
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
      if (items.length === 0) throw new OrderRefused({ status: "empty" });
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
      if (shortItems.length > 0) throw new OrderRefused({ status: "short", shortItems });

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
      return { status: "placed", orderId: order.rows[0].id, productIds };
    });
  } catch (error) {
    if (error instanceof OrderRefused) return error.outcome;
    throw error;
  }
}
