import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { getPool } from "../src/db/client";
import { addToCart, getCart, getCartCount, MAX_LINE_QUANTITY, removeFromCart, setCartQuantity } from "../src/lib/cart";
import { insertCategory, insertProduct, resetTables } from "./helpers";

const pool = getPool();
const visitor = "11111111-1111-4111-8111-111111111111";
const otherVisitor = "22222222-2222-4222-8222-222222222222";
let hammer: number;
let ruler: number;

beforeAll(async () => {
  await resetTables();
  const tools = await insertCategory("tools", "Tools");
  hammer = await insertProduct({ title: "Claw Hammer", categoryId: tools, priceCents: 1899, stock: 5 });
  ruler = await insertProduct({ title: "Steel Ruler", categoryId: tools, priceCents: 650, stock: 2 });
});

beforeEach(async () => {
  await pool.query("TRUNCATE cart_items, carts");
});

describe("cart", () => {
  test("is empty for a visitor who has not added anything", async () => {
    expect(await getCart(pool, visitor)).toEqual({ lines: [], count: 0, subtotalCents: 0 });
    expect(await getCartCount(pool, visitor)).toBe(0);
  });

  test("add creates the cart and the line", async () => {
    expect(await addToCart(pool, visitor, hammer)).toBe(true);
    const cart = await getCart(pool, visitor);
    expect(cart.lines).toHaveLength(1);
    expect(cart.lines[0]).toMatchObject({ productId: hammer, title: "Claw Hammer", quantity: 1, priceCents: 1899, stock: 5 });
    expect(cart.count).toBe(1);
    expect(cart.subtotalCents).toBe(1899);
  });

  test("adding the same product again raises the quantity instead of adding a line", async () => {
    await addToCart(pool, visitor, hammer);
    await addToCart(pool, visitor, hammer, 2);
    await addToCart(pool, visitor, ruler);
    const cart = await getCart(pool, visitor);
    expect(cart.lines.map((l) => [l.productId, l.quantity])).toEqual([
      [hammer, 3],
      [ruler, 1],
    ]);
    expect(cart.count).toBe(4);
    expect(cart.subtotalCents).toBe(3 * 1899 + 650);
    expect(await getCartCount(pool, visitor)).toBe(4);
  });

  test("change quantity sets the exact number", async () => {
    await addToCart(pool, visitor, hammer);
    expect(await setCartQuantity(pool, visitor, hammer, 4)).toBe(true);
    expect((await getCart(pool, visitor)).lines[0].quantity).toBe(4);
    expect(await setCartQuantity(pool, visitor, hammer, 2)).toBe(true);
    expect((await getCart(pool, visitor)).lines[0].quantity).toBe(2);
  });

  test("a quantity of zero removes the line", async () => {
    await addToCart(pool, visitor, hammer);
    await setCartQuantity(pool, visitor, hammer, 0);
    expect((await getCart(pool, visitor)).lines).toEqual([]);
  });

  test("remove deletes only that line", async () => {
    await addToCart(pool, visitor, hammer);
    await addToCart(pool, visitor, ruler);
    expect(await removeFromCart(pool, visitor, hammer)).toBe(true);
    expect((await getCart(pool, visitor)).lines.map((l) => l.productId)).toEqual([ruler]);
    expect(await removeFromCart(pool, visitor, hammer)).toBe(false);
  });

  test("caps a line and rejects quantities that are not whole and positive", async () => {
    await addToCart(pool, visitor, hammer, 500);
    expect((await getCart(pool, visitor)).lines[0].quantity).toBe(MAX_LINE_QUANTITY);
    await addToCart(pool, visitor, hammer, 5);
    expect((await getCart(pool, visitor)).lines[0].quantity).toBe(MAX_LINE_QUANTITY);
    expect(await addToCart(pool, visitor, ruler, 0)).toBe(false);
    expect(await addToCart(pool, visitor, ruler, 1.5)).toBe(false);
    expect(await addToCart(pool, visitor, ruler, -2)).toBe(false);
  });

  test("refuses a product that does not exist", async () => {
    expect(await addToCart(pool, visitor, 999999)).toBe(false);
    expect((await getCart(pool, visitor)).lines).toEqual([]);
  });

  test("keeps each visitor's cart separate", async () => {
    await addToCart(pool, visitor, hammer);
    await addToCart(pool, otherVisitor, ruler, 2);
    expect((await getCart(pool, visitor)).lines.map((l) => l.productId)).toEqual([hammer]);
    expect((await getCart(pool, otherVisitor)).lines.map((l) => l.productId)).toEqual([ruler]);
    expect(await setCartQuantity(pool, otherVisitor, hammer, 9)).toBe(false);
    expect((await getCart(pool, visitor)).lines[0].quantity).toBe(1);
  });

  test("shows the product's current price, and never changes stock", async () => {
    await addToCart(pool, visitor, hammer, 2);
    await pool.query("UPDATE products SET price_cents = 2100 WHERE id = $1", [hammer]);
    const cart = await getCart(pool, visitor);
    expect(cart.lines[0].priceCents).toBe(2100);
    expect(cart.subtotalCents).toBe(4200);
    expect(cart.lines[0].stock).toBe(5);
    await pool.query("UPDATE products SET price_cents = 1899 WHERE id = $1", [hammer]);
  });
});
