import { beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { getDb } from "../src/db/drizzle";
import { listProducts } from "../src/lib/products";
import { insertCategory, insertProduct, resetTables } from "./helpers";

// The database is remote: a test with many round trips needs more than the default 5 seconds.
setDefaultTimeout(120_000);

const db = getDb();

const titles = async (q: string, extra: { category?: string; sort?: string } = {}) => {
  const result = await listProducts(db, { q, ...extra });
  return { titles: result.items.map((item) => item.title), match: result.match, total: result.total };
};

beforeAll(async () => {
  await resetTables();
  const tools = await insertCategory("tools", "Tools");
  const kitchen = await insertCategory("kitchen", "Kitchen");
  await insertProduct({ title: "Claw Hammer", description: "Forged steel head with an ash handle", categoryId: tools });
  await insertProduct({ title: "Rubber Mallet", description: "A soft hammer for tiles and joinery", categoryId: tools });
  await insertProduct({ title: "Steel Ruler", description: "Engraved markings, 30 cm", categoryId: tools });
  await insertProduct({ title: "Cast Iron Skillet", description: "Pre-seasoned pan for the hob or oven", categoryId: kitchen });
  await insertProduct({ title: "Smartphone Stand", description: "Holds a tablet too", categoryId: kitchen });
  await insertProduct({ title: "Phone Charger", description: "Fast charging over USB-C", categoryId: tools });
});

describe("full-text search", () => {
  test("matches words in the title and the description", async () => {
    const result = await titles("hammer");
    expect(result.match).toBe("text");
    expect(result.titles.sort()).toEqual(["Claw Hammer", "Rubber Mallet"]);
  });

  test("ranks a title match above a description match", async () => {
    expect((await titles("hammer")).titles).toEqual(["Claw Hammer", "Rubber Mallet"]);
    expect((await titles("steel")).titles).toEqual(["Steel Ruler", "Claw Hammer"]);
  });

  test("needs every word to match, and stems plurals", async () => {
    expect((await titles("steel hammers")).titles).toEqual(["Claw Hammer"]);
  });

  test("understands quotes and exclusions the way a search box user expects", async () => {
    expect((await titles('"cast iron"')).titles).toEqual(["Cast Iron Skillet"]);
    expect((await titles("steel -ruler")).titles).toEqual(["Claw Hammer"]);
  });

  test("finds a name that contains the query, after the exact word matches", async () => {
    expect((await titles("phone")).titles).toEqual(["Phone Charger", "Smartphone Stand"]);
  });

  test("keeps the category filter", async () => {
    const result = await titles("steel", { category: "kitchen" });
    expect(result.titles).toEqual([]);
    expect(result.total).toBe(0);
    expect((await titles("pan", { category: "kitchen" })).titles).toEqual(["Cast Iron Skillet"]);
  });

  test("can sort matches by something other than relevance", async () => {
    const result = await listProducts(db, { q: "hammer", sort: "newest" });
    expect(result.sort).toBe("newest");
    expect(result.items.map((i) => i.title)).toEqual(["Rubber Mallet", "Claw Hammer"]);
  });
});

describe("trigram fallback", () => {
  test("finds close names when full-text search finds nothing", async () => {
    const result = await titles("hammr");
    expect(result.match).toBe("fuzzy");
    expect(result.titles).toEqual(["Claw Hammer"]);
  });

  test("survives a typo in a longer word", async () => {
    expect((await titles("skilet")).titles).toEqual(["Cast Iron Skillet"]);
  });

  test("returns nothing rather than unrelated products", async () => {
    const result = await titles("zzzzqqq");
    expect(result.titles).toEqual([]);
    expect(result.total).toBe(0);
  });

  test("is not used while full-text search has matches", async () => {
    expect((await titles("ruler")).match).toBe("text");
  });
});

test("treats LIKE wildcards and SQL in the query as plain text", async () => {
  expect((await titles("%")).titles).toEqual([]);
  expect((await titles("'; DROP TABLE products; --")).titles).toEqual([]);
  expect((await titles("hammer")).titles).toHaveLength(2);
});

describe("paging", () => {
  test("walks forward and back through every product with keyset cursors", async () => {
    const page1 = await listProducts(db, { sort: "price-asc", limit: 2 });
    const page2 = await listProducts(db, { sort: "price-asc", limit: 2, after: page1.nextCursor! });
    const page3 = await listProducts(db, { sort: "price-asc", limit: 2, after: page2.nextCursor! });
    const forward = [page1, page2, page3].map((p) => p.items.map((item) => item.id));
    expect(new Set(forward.flat()).size).toBe(6);
    expect(page3.nextCursor).toBeNull();

    const back2 = await listProducts(db, { sort: "price-asc", limit: 2, before: page3.prevCursor! });
    const back1 = await listProducts(db, { sort: "price-asc", limit: 2, before: back2.prevCursor! });
    expect([back1, back2].map((p) => p.items.map((item) => item.id))).toEqual(forward.slice(0, 2));
    expect(back1.prevCursor).toBeNull();
  });

  // Every sort, so each one reaches the keyset page with the right column, cast, direction and key.
  const sorts: Array<{ sort: string; q?: string; limit: number }> = [
    { sort: "price-asc", limit: 2 },
    { sort: "price-desc", limit: 2 },
    { sort: "rating", limit: 2 },
    { sort: "newest", limit: 2 },
    { sort: "relevance", q: "hammer", limit: 1 },
  ];
  for (const { sort, q, limit } of sorts) {
    test(`pages through "${sort}" in the same order as one unpaged read, forward and back`, async () => {
      const all = (await listProducts(db, { sort, q })).items.map((item) => item.id);
      const forward = [await listProducts(db, { sort, q, limit })];
      while (forward[forward.length - 1].nextCursor) {
        forward.push(await listProducts(db, { sort, q, limit, after: forward[forward.length - 1].nextCursor! }));
      }
      const ids = (pages: typeof forward) => pages.map((p) => p.items.map((item) => item.id));
      expect(ids(forward).flat()).toEqual(all);

      const backward = [forward[forward.length - 1]];
      while (backward[0].prevCursor) {
        backward.unshift(await listProducts(db, { sort, q, limit, before: backward[0].prevCursor! }));
      }
      expect(ids(backward)).toEqual(ids(forward));
    });
  }
});
