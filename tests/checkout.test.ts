import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { getPool } from "../src/db/client";
import { getDb } from "../src/db/drizzle";
import { addToCart, getCart } from "../src/lib/cart";
import { checkout } from "../src/lib/checkout";
import { getOrder } from "../src/lib/orders";
import { insertCategory, insertProduct, resetTables } from "./helpers";

// The database is remote: a test with many round trips needs more than the default 5 seconds.
setDefaultTimeout(120_000);

const pool = getPool();
const db = getDb();
const shipping = { name: "Ada Lovelace", street: "12 Analytical Row", city: "London", postcode: "N1 9GU" };

let tools: number;
let hammer: number;
let ruler: number;

const stockOf = async (id: number) =>
  (await pool.query<{ stock: number }>("SELECT stock FROM products WHERE id = $1", [id])).rows[0].stock;
const orderCount = async () => (await pool.query<{ n: number }>("SELECT count(*)::int AS n FROM orders")).rows[0].n;
const ignore = () => {};

beforeEach(async () => {
  await resetTables();
  tools = await insertCategory("tools", "Tools");
  hammer = await insertProduct({ title: "Claw Hammer", categoryId: tools, priceCents: 1899, stock: 5 });
  ruler = await insertProduct({ title: "Steel Ruler", categoryId: tools, priceCents: 650, stock: 2 });
});

describe("checkout: placed", () => {
  test("creates the order, copies title and price, takes stock and empties the cart", async () => {
    const visitor = randomUUID();
    await addToCart(db, visitor, hammer, 2);
    await addToCart(db, visitor, ruler, 1);

    const result = await checkout(db, visitor, shipping, ignore);
    if (result.status !== "placed") throw new Error(`expected placed, got ${result.status}`);

    expect(await stockOf(hammer)).toBe(3);
    expect(await stockOf(ruler)).toBe(1);
    expect((await getCart(db, visitor)).lines).toEqual([]);

    const order = await getOrder(db, visitor, result.orderId);
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

  test("tells the cache once about every product in the order", async () => {
    const visitor = randomUUID();
    await addToCart(db, visitor, ruler, 1);
    await addToCart(db, visitor, hammer, 1);
    const calls: number[][] = [];
    await checkout(db, visitor, shipping, (ids) => calls.push(ids));
    expect(calls.map((ids) => [...ids].sort((a, b) => a - b))).toEqual([[hammer, ruler]]);
  });

  test("tells the cache only after the commit, and a failure there neither undoes nor hides the order", async () => {
    const visitor = randomUUID();
    await addToCart(db, visitor, hammer, 2);
    const failing = () => {
      throw new Error("cache unavailable");
    };
    const result = await checkout(db, visitor, shipping, failing);
    expect(result.status).toBe("placed");
    // Inside the transaction, the throw would have rolled the order back.
    expect(await orderCount()).toBe(1);
    expect(await stockOf(hammer)).toBe(3);
  });

  test("fixes the price at order time, whatever the product costs later", async () => {
    const visitor = randomUUID();
    await addToCart(db, visitor, hammer, 1);
    await pool.query("UPDATE products SET price_cents = 2500 WHERE id = $1", [hammer]);
    const result = await checkout(db, visitor, shipping, ignore);
    if (result.status !== "placed") throw new Error(`expected placed, got ${result.status}`);
    await pool.query("UPDATE products SET price_cents = 9999, title = 'Renamed' WHERE id = $1", [hammer]);

    const order = await getOrder(db, visitor, result.orderId);
    expect(order!.totalCents).toBe(2500);
    expect(order!.items[0]).toMatchObject({ title: "Claw Hammer", unitPriceCents: 2500 });
  });

  test("lets the last unit be ordered", async () => {
    const visitor = randomUUID();
    await addToCart(db, visitor, ruler, 2);
    expect((await checkout(db, visitor, shipping, ignore)).status).toBe("placed");
    expect(await stockOf(ruler)).toBe(0);
  });
});

describe("checkout: shipping rules", () => {
  test("names every missing field, and places nothing", async () => {
    const visitor = randomUUID();
    await addToCart(db, visitor, hammer, 1);
    const calls: number[][] = [];

    const result = await checkout(db, visitor, { name: "  ", street: undefined, city: 42 }, (ids) =>
      calls.push(ids),
    );

    expect(result).toEqual({
      status: "invalid",
      errors: {
        name: "Enter the name of the person receiving the order.",
        street: "Enter a street address.",
        city: "Enter a town or city.",
        postcode: "Enter a postcode.",
      },
      values: { name: "", street: "", city: "", postcode: "" },
    });
    expect(await orderCount()).toBe(0);
    expect(await stockOf(hammer)).toBe(5);
    expect((await getCart(db, visitor)).lines).toHaveLength(1);
    expect(calls).toEqual([]);
  });

  test("refuses a field over its limit", async () => {
    const visitor = randomUUID();
    await addToCart(db, visitor, hammer, 1);
    const tooLong = { name: "a".repeat(101), street: "s".repeat(201), city: "c".repeat(101), postcode: "1".repeat(21) };
    const result = await checkout(db, visitor, tooLong, ignore);
    expect(result).toMatchObject({
      status: "invalid",
      errors: {
        name: "Use 100 characters or fewer.",
        street: "Use 200 characters or fewer.",
        city: "Use 100 characters or fewer.",
        postcode: "Use 20 characters or fewer.",
      },
    });
    expect(await orderCount()).toBe(0);
  });

  test("allows every field at its limit", async () => {
    const visitor = randomUUID();
    await addToCart(db, visitor, hammer, 1);
    const atLimit = { name: "a".repeat(100), street: "s".repeat(200), city: "c".repeat(100), postcode: "1".repeat(20) };
    const result = await checkout(db, visitor, atLimit, ignore);
    expect(result.status).toBe("placed");
  });

  test("trims each field and squeezes runs of whitespace before storing it", async () => {
    const visitor = randomUUID();
    await addToCart(db, visitor, hammer, 1);
    const result = await checkout(
      db,
      visitor,
      { name: "  Ada \t Lovelace ", street: "12   Analytical\nRow", city: " London ", postcode: "N1  9GU" },
      ignore,
    );
    if (result.status !== "placed") throw new Error(`expected placed, got ${result.status}`);
    expect(await getOrder(db, visitor, result.orderId)).toMatchObject({
      shippingName: "Ada Lovelace",
      shippingAddress: "12 Analytical Row\nLondon N1 9GU",
    });
  });
});

describe("checkout: empty", () => {
  test("does nothing for an empty cart, an unknown visitor or no visitor at all", async () => {
    const calls: number[][] = [];
    const record = (ids: number[]) => calls.push(ids);
    expect(await checkout(db, randomUUID(), shipping, record)).toEqual({ status: "empty", values: shipping });
    expect(await checkout(db, null, shipping, record)).toEqual({ status: "empty", values: shipping });
    expect(await orderCount()).toBe(0);
    expect(calls).toEqual([]);
  });

  test("checks the fields before the cart", async () => {
    const result = await checkout(db, null, { ...shipping, city: "" }, ignore);
    expect(result).toMatchObject({ status: "invalid", errors: { city: "Enter a town or city." } });
  });
});

describe("checkout: short stock", () => {
  test("leaves stock and the cart unchanged and names every short item", async () => {
    const visitor = randomUUID();
    await addToCart(db, visitor, hammer, 2);
    await addToCart(db, visitor, ruler, 3);
    const cartBefore = await getCart(db, visitor);

    const result = await checkout(db, visitor, shipping, ignore);
    expect(result).toEqual({
      status: "short",
      shortItems: [{ productId: ruler, title: "Steel Ruler", requested: 3, available: 2 }],
      values: shipping,
    });

    expect(await stockOf(hammer)).toBe(5);
    expect(await stockOf(ruler)).toBe(2);
    expect(await getCart(db, visitor)).toEqual(cartBefore);
    expect(await orderCount()).toBe(0);
  });

  test("reports an item that has sold out as zero available", async () => {
    const visitor = randomUUID();
    await addToCart(db, visitor, hammer, 1);
    await pool.query("UPDATE products SET stock = 0 WHERE id = $1", [hammer]);
    const result = await checkout(db, visitor, shipping, ignore);
    expect(result).toMatchObject({ status: "short", shortItems: [{ productId: hammer, available: 0 }] });
  });

  test("tells the cache about the short items only, whose pages show more stock than there is", async () => {
    const visitor = randomUUID();
    await addToCart(db, visitor, hammer, 2);
    await addToCart(db, visitor, ruler, 3);
    const calls: number[][] = [];
    await checkout(db, visitor, shipping, (ids) => calls.push(ids));
    expect(calls).toEqual([[ruler]]);
  });
});

describe("checkout: concurrency", () => {
  test("ten carts race for one unit: exactly one order succeeds and stock ends at 0", async () => {
    const last = await insertProduct({ title: "Last One", categoryId: tools, priceCents: 500, stock: 1 });
    const visitors = Array.from({ length: 10 }, () => randomUUID());
    for (const visitor of visitors) await addToCart(db, visitor, last, 1);

    const results = await Promise.all(visitors.map((visitor) => checkout(db, visitor, shipping, ignore)));

    expect(results.filter((r) => r.status === "placed")).toHaveLength(1);
    const losers = results.filter((r) => r.status !== "placed");
    expect(losers).toHaveLength(9);
    for (const loser of losers) {
      expect(loser).toMatchObject({ status: "short", shortItems: [{ productId: last, requested: 1, available: 0 }] });
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
      await addToCart(db, visitor, first, 1);
      await addToCart(db, visitor, second, 1);
    }

    const results = await Promise.all(visitors.map((visitor) => checkout(db, visitor, shipping, ignore)));

    expect(results.every((r) => r.status === "placed")).toBe(true);
    expect(await stockOf(hammer)).toBe(90);
    expect(await stockOf(ruler)).toBe(90);
  });

  test("the same cart submitted twice at once makes one order", async () => {
    const visitor = randomUUID();
    await addToCart(db, visitor, hammer, 2);
    const results = await Promise.all([checkout(db, visitor, shipping, ignore), checkout(db, visitor, shipping, ignore)]);
    expect(results.filter((r) => r.status === "placed")).toHaveLength(1);
    expect(results.filter((r) => r.status !== "placed")).toEqual([{ status: "empty", values: shipping }]);
    expect(await stockOf(hammer)).toBe(3);
    expect(await orderCount()).toBe(1);
  });
});
