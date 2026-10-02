import { beforeAll, describe, expect, test } from "bun:test";
import { getPool } from "../src/db/client";
import { listProducts, PAGE_SIZE, type ListParams, type ListResult } from "../src/lib/products";
import { insertCategory, insertProduct, resetTables } from "./helpers";

const pool = getPool();
const TOTAL = 60;

beforeAll(async () => {
  await resetTables();
  const tools = await insertCategory("tools", "Tools");
  const toys = await insertCategory("toys", "Toys");
  // Few distinct prices, ratings and dates, so every sort has many ties to break.
  for (let i = 0; i < TOTAL; i++) {
    await insertProduct({
      title: i % 2 === 0 ? `Widget number ${i}` : `Gadget ${i}`,
      description: i % 2 === 0 ? "A plain part" : "Fits any widget",
      categoryId: i % 3 === 0 ? toys : tools,
      priceCents: 500 + (i % 5) * 100,
      ratingAvg: 3 + (i % 4) * 0.5,
      createdAt: new Date(Date.UTC(2026, 0, 1 + (i % 3))),
    });
  }
});

async function walkForward(params: ListParams): Promise<ListResult[]> {
  const pages: ListResult[] = [];
  let after: string | undefined;
  do {
    const page = await listProducts(pool, { ...params, after });
    pages.push(page);
    after = page.nextCursor ?? undefined;
    if (pages.length > 20) throw new Error("Forward walk did not end");
  } while (after);
  return pages;
}

async function walkBackward(params: ListParams, from: ListResult): Promise<ListResult[]> {
  const pages: ListResult[] = [from];
  let before = from.prevCursor ?? undefined;
  while (before) {
    const page = await listProducts(pool, { ...params, before });
    pages.unshift(page);
    before = page.prevCursor ?? undefined;
    if (pages.length > 20) throw new Error("Backward walk did not end");
  }
  return pages;
}

const ids = (pages: ListResult[]) => pages.map((page) => page.items.map((item) => item.id));

const cases: Array<{ name: string; params: ListParams; total: number }> = [
  { name: "price low to high", params: { sort: "price-asc" }, total: TOTAL },
  { name: "price high to low", params: { sort: "price-desc" }, total: TOTAL },
  { name: "rating", params: { sort: "rating" }, total: TOTAL },
  { name: "newest", params: { sort: "newest" }, total: TOTAL },
  { name: "relevance", params: { q: "widget", sort: "relevance" }, total: TOTAL },
  { name: "price within one category", params: { sort: "price-asc", category: "tools" }, total: 40 },
];

describe("keyset pagination", () => {
  for (const { name, params, total } of cases) {
    describe(name, () => {
      test("walking forward returns every product exactly once", async () => {
        const pages = await walkForward(params);
        const seen = ids(pages).flat();
        expect(seen).toHaveLength(total);
        expect(new Set(seen).size).toBe(total);
        expect(pages.map((p) => p.items.length)).toEqual(
          Array.from({ length: Math.ceil(total / PAGE_SIZE) }, (_, i) => Math.min(PAGE_SIZE, total - i * PAGE_SIZE)),
        );
        expect(pages[0].prevCursor).toBeNull();
        expect(pages[pages.length - 1].nextCursor).toBeNull();
        for (const page of pages) expect(page.total).toBe(total);
      });

      test("walking backward returns the same pages", async () => {
        const forward = await walkForward(params);
        const backward = await walkBackward(params, forward[forward.length - 1]);
        expect(ids(backward)).toEqual(ids(forward));
      });
    });
  }

  test("orders by the sort value, then by id, so ties are stable", async () => {
    const byPrice = (await walkForward({ sort: "price-asc" })).flatMap((p) => p.items);
    for (let i = 1; i < byPrice.length; i++) {
      const [a, b] = [byPrice[i - 1], byPrice[i]];
      expect(a.priceCents < b.priceCents || (a.priceCents === b.priceCents && a.id < b.id)).toBe(true);
    }
    const byRating = (await walkForward({ sort: "rating" })).flatMap((p) => p.items);
    for (let i = 1; i < byRating.length; i++) {
      const [a, b] = [byRating[i - 1], byRating[i]];
      expect(a.ratingAvg > b.ratingAvg || (a.ratingAvg === b.ratingAvg && a.id > b.id)).toBe(true);
    }
  });

  test("treats a cursor it cannot read as the first page", async () => {
    const first = await listProducts(pool, { sort: "price-asc" });
    for (const after of ["not-a-cursor", Buffer.from('["1; DROP TABLE products", 1]').toString("base64url")]) {
      const page = await listProducts(pool, { sort: "price-asc", after });
      expect(page.items.map((i) => i.id)).toEqual(first.items.map((i) => i.id));
    }
  });

  test("returns a short page when a smaller limit is asked for", async () => {
    const page = await listProducts(pool, { sort: "newest", limit: 6 });
    expect(page.items).toHaveLength(6);
    expect(page.nextCursor).not.toBeNull();
  });
});
