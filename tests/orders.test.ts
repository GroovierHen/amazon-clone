import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, test } from "bun:test";
import { getPool } from "../src/db/client";
import { addToCart, getCart } from "../src/lib/cart";
import { getOrder, listOrders, placeOrder } from "../src/lib/orders";
import { insertCategory, insertProduct, resetTables } from "./helpers";

const pool = getPool();
const shipping = { name: "Ada Lovelace", address: "12 Analytical Row\nLondon N1 9GU" };

let tools: number;
let hammer: number;
let ruler: number;

const stockOf = async (id: number) =>
  (await pool.query<{ stock: number }>("SELECT stock FROM products WHERE id = $1", [id])).rows[0].stock;
const orderCount = async () => (await pool.query<{ n: number }>("SELECT count(*)::int AS n FROM orders")).rows[0].n;

beforeEach(async () => {
  await resetTables();
  tools = await insertCategory("tools", "Tools");
  hammer = await insertProduct({ title: "Claw Hammer", categoryId: tools, priceCents: 1899, stock: 5 });
  ruler = await insertProduct({ title: "Steel Ruler", categoryId: tools, priceCents: 650, stock: 2 });
});

describe("place order: success", () => {
  test("creates the order, copies title and price, takes stock and empties the cart", async () => {
    const visitor = randomUUID();
    await addToCart(pool, visitor, hammer, 2);
    await addToCart(pool, visitor, ruler, 1);

    const result = await placeOrder(pool, visitor, shipping);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.productIds.sort()).toEqual([hammer, ruler].sort());

    expect(await stockOf(hammer)).toBe(3);
    expect(await stockOf(ruler)).toBe(1);
    expect((await getCart(pool, visitor)).lines).toEqual([]);

    const order = await getOrder(pool, visitor, result.orderId);
    expect(order).toMatchObject({
      status: "placed",
      totalCents: 2 * 1899 + 650,
      shippingName: "Ada Lovelace",
      shippingAddress: "12 Analytical Row\nLondon N1 9GU",
    });
    expect(order!.items.map((i) => [i.title, i.quantity, i.unitPriceCents])).toEqual([
      ["Claw Hammer", 2, 1899],
      ["Steel Ruler", 1, 650],
    ]);
  });

  test("fixes the price at order time, whatever the product costs later", async () => {
    const visitor = randomUUID();
    await addToCart(pool, visitor, hammer, 1);
    await pool.query("UPDATE products SET price_cents = 2500 WHERE id = $1", [hammer]);
    const result = await placeOrder(pool, visitor, shipping);
    if (!result.ok) throw new Error("order should have been placed");
    await pool.query("UPDATE products SET price_cents = 9999, title = 'Renamed' WHERE id = $1", [hammer]);

    const order = await getOrder(pool, visitor, result.orderId);
    expect(order!.totalCents).toBe(2500);
    expect(order!.items[0]).toMatchObject({ title: "Claw Hammer", unitPriceCents: 2500 });
  });

  test("lets the last unit be ordered", async () => {
    const visitor = randomUUID();
    await addToCart(pool, visitor, ruler, 2);
    expect((await placeOrder(pool, visitor, shipping)).ok).toBe(true);
    expect(await stockOf(ruler)).toBe(0);
  });
});

describe("place order: short stock", () => {
  test("leaves stock and the cart unchanged and names every short item", async () => {
    const visitor = randomUUID();
    await addToCart(pool, visitor, hammer, 2);
    await addToCart(pool, visitor, ruler, 3);
    const cartBefore = await getCart(pool, visitor);

    const result = await placeOrder(pool, visitor, shipping);
    expect(result).toEqual({
      ok: false,
      reason: "short",
      shortItems: [{ productId: ruler, title: "Steel Ruler", requested: 3, available: 2 }],
    });

    expect(await stockOf(hammer)).toBe(5);
    expect(await stockOf(ruler)).toBe(2);
    expect(await getCart(pool, visitor)).toEqual(cartBefore);
    expect(await orderCount()).toBe(0);
  });

  test("reports an item that has sold out as zero available", async () => {
    const visitor = randomUUID();
    await addToCart(pool, visitor, hammer, 1);
    await pool.query("UPDATE products SET stock = 0 WHERE id = $1", [hammer]);
    const result = await placeOrder(pool, visitor, shipping);
    expect(result).toMatchObject({ ok: false, reason: "short", shortItems: [{ productId: hammer, available: 0 }] });
  });

  test("does nothing for an empty cart or an unknown visitor", async () => {
    expect(await placeOrder(pool, randomUUID(), shipping)).toEqual({ ok: false, reason: "empty" });
    expect(await orderCount()).toBe(0);
  });
});

describe("place order: concurrency", () => {
  test("ten carts race for one unit: exactly one order succeeds and stock ends at 0", async () => {
    const last = await insertProduct({ title: "Last One", categoryId: tools, priceCents: 500, stock: 1 });
    const visitors = Array.from({ length: 10 }, () => randomUUID());
    for (const visitor of visitors) await addToCart(pool, visitor, last, 1);

    const results = await Promise.all(visitors.map((visitor) => placeOrder(pool, visitor, shipping)));

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    const losers = results.filter((r) => !r.ok);
    expect(losers).toHaveLength(9);
    for (const loser of losers) {
      expect(loser).toMatchObject({ reason: "short", shortItems: [{ productId: last, requested: 1, available: 0 }] });
    }
    expect(await stockOf(last)).toBe(0);
    expect(await orderCount()).toBe(1);
    // The nine who lost still have the item in their carts.
    const cartsLeft = await pool.query<{ n: number }>("SELECT count(*)::int AS n FROM cart_items WHERE product_id = $1", [last]);
    expect(cartsLeft.rows[0].n).toBe(9);
  });

  test("carts that share products in opposite orders do not deadlock", async () => {
    await pool.query("UPDATE products SET stock = 100 WHERE id = ANY($1::bigint[])", [[hammer, ruler]]);
    const visitors = Array.from({ length: 10 }, () => randomUUID());
    for (const [i, visitor] of visitors.entries()) {
      // Half add the hammer first, half the ruler first.
      const [first, second] = i % 2 === 0 ? [hammer, ruler] : [ruler, hammer];
      await addToCart(pool, visitor, first, 1);
      await addToCart(pool, visitor, second, 1);
    }

    const results = await Promise.all(visitors.map((visitor) => placeOrder(pool, visitor, shipping)));

    expect(results.every((r) => r.ok)).toBe(true);
    expect(await stockOf(hammer)).toBe(90);
    expect(await stockOf(ruler)).toBe(90);
  });

  test("the same cart submitted twice at once makes one order", async () => {
    const visitor = randomUUID();
    await addToCart(pool, visitor, hammer, 2);
    const results = await Promise.all([placeOrder(pool, visitor, shipping), placeOrder(pool, visitor, shipping)]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toEqual([{ ok: false, reason: "empty" }]);
    expect(await stockOf(hammer)).toBe(3);
    expect(await orderCount()).toBe(1);
  });
});

describe("order history", () => {
  test("lists a visitor's orders newest first, and nobody else's", async () => {
    const visitor = randomUUID();
    const stranger = randomUUID();
    const ids: number[] = [];
    for (let i = 0; i < 3; i++) {
      await addToCart(pool, visitor, hammer, 1);
      const result = await placeOrder(pool, visitor, shipping);
      if (!result.ok) throw new Error("order should have been placed");
      ids.push(result.orderId);
    }
    await addToCart(pool, stranger, ruler, 1);
    const theirs = await placeOrder(pool, stranger, shipping);
    if (!theirs.ok) throw new Error("order should have been placed");

    const list = await listOrders(pool, visitor);
    expect(list.orders.map((o) => o.id)).toEqual([...ids].reverse());
    expect(list.orders[0]).toMatchObject({ itemCount: 1, totalCents: 1899, titles: ["Claw Hammer"] });
    expect(list.nextCursor).toBeNull();
    expect(list.prevCursor).toBeNull();

    expect(await getOrder(pool, visitor, theirs.orderId)).toBeNull();
    expect(await getOrder(pool, stranger, ids[0])).toBeNull();
    expect((await listOrders(pool, randomUUID())).orders).toEqual([]);
  });

  test("pages through orders with a keyset cursor, forward and back", async () => {
    const visitor = randomUUID();
    await pool.query("UPDATE products SET stock = 100 WHERE id = $1", [hammer]);
    const ids: number[] = [];
    for (let i = 0; i < 5; i++) {
      await addToCart(pool, visitor, hammer, 1);
      const result = await placeOrder(pool, visitor, shipping);
      if (!result.ok) throw new Error("order should have been placed");
      ids.push(result.orderId);
    }
    // Give several orders the same timestamp, so the id has to break the tie.
    await pool.query("UPDATE orders SET created_at = '2026-01-01T00:00:00Z' WHERE id = ANY($1::bigint[])", [ids.slice(0, 4)]);
    const newestFirst = [ids[4], ids[3], ids[2], ids[1], ids[0]];

    const page1 = await listOrders(pool, visitor, { limit: 2 });
    const page2 = await listOrders(pool, visitor, { limit: 2, after: page1.nextCursor! });
    const page3 = await listOrders(pool, visitor, { limit: 2, after: page2.nextCursor! });
    expect([page1, page2, page3].flatMap((p) => p.orders.map((o) => o.id))).toEqual(newestFirst);
    expect(page3.nextCursor).toBeNull();

    const back2 = await listOrders(pool, visitor, { limit: 2, before: page3.prevCursor! });
    const back1 = await listOrders(pool, visitor, { limit: 2, before: back2.prevCursor! });
    expect(back2.orders.map((o) => o.id)).toEqual(page2.orders.map((o) => o.id));
    expect(back1.orders.map((o) => o.id)).toEqual(page1.orders.map((o) => o.id));
    expect(back1.prevCursor).toBeNull();
  });
});
