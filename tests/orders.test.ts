import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { getDb } from "../src/db/drizzle";
import { addToCart } from "../src/lib/cart";
import { checkout } from "../src/lib/checkout";
import { getOrder, listOrders } from "../src/lib/orders";
import { insertCategory, insertProduct, resetTables } from "./helpers";

// The database is remote: a test with many round trips needs more than the default 5 seconds.
setDefaultTimeout(120_000);

const db = getDb();
const shipping = { name: "Ada Lovelace", street: "12 Analytical Row", city: "London", postcode: "N1 9GU" };

/** Places an order for whatever is in the visitor's cart, and returns its id. */
async function orderCart(visitor: string): Promise<number> {
  const result = await checkout(db, visitor, shipping, () => {});
  if (result.status !== "placed") throw new Error(`expected placed, got ${result.status}`);
  return result.orderId;
}

let tools: number;
let hammer: number;
let ruler: number;

beforeEach(async () => {
  await resetTables();
  tools = await insertCategory("tools", "Tools");
  hammer = await insertProduct({ title: "Claw Hammer", categoryId: tools, priceCents: 1899, stock: 5 });
  ruler = await insertProduct({ title: "Steel Ruler", categoryId: tools, priceCents: 650, stock: 2 });
});

describe("order history", () => {
  test("lists a visitor's orders newest first, and nobody else's", async () => {
    const visitor = randomUUID();
    const stranger = randomUUID();
    const ids: number[] = [];
    for (let i = 0; i < 3; i++) {
      await addToCart(db, visitor, hammer, 1);
      ids.push(await orderCart(visitor));
    }
    await addToCart(db, stranger, ruler, 1);
    const theirs = await orderCart(stranger);

    const list = await listOrders(db, visitor);
    expect(list.orders.map((o) => o.id)).toEqual([...ids].reverse());
    expect(list.orders[0]).toMatchObject({ itemCount: 1, totalCents: 1899, titles: ["Claw Hammer"] });
    expect(list.nextCursor).toBeNull();
    expect(list.prevCursor).toBeNull();

    expect(await getOrder(db, visitor, theirs)).toBeNull();
    expect(await getOrder(db, stranger, ids[0])).toBeNull();
    expect((await listOrders(db, randomUUID())).orders).toEqual([]);
  });

  test("pages through orders with keyset cursors, forward and back", async () => {
    const visitor = randomUUID();
    const ids: number[] = [];
    for (let i = 0; i < 3; i++) {
      await addToCart(db, visitor, hammer, 1);
      ids.push(await orderCart(visitor));
    }

    const page1 = await listOrders(db, visitor, { limit: 2 });
    const page2 = await listOrders(db, visitor, { limit: 2, after: page1.nextCursor! });
    expect([page1, page2].map((p) => p.orders.map((o) => o.id))).toEqual([[ids[2], ids[1]], [ids[0]]]);
    expect(page2.nextCursor).toBeNull();

    const back = await listOrders(db, visitor, { limit: 2, before: page2.prevCursor! });
    expect(back.orders.map((o) => o.id)).toEqual([ids[2], ids[1]]);
    expect(back.prevCursor).toBeNull();
  });
});
