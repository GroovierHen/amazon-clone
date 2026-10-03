import { beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { asc, desc, eq, sql, type SQL } from "drizzle-orm";
import { getDb } from "../src/db/drizzle";
import { products } from "../src/db/schema";
import { keysetPage, PAGE_SIZE, type KeysetOptions, type KeysetResult, type KeysetSort } from "../src/lib/keyset";
import { insertCategory, insertProducts, resetTables } from "./helpers";

// The database is remote: a test with many round trips needs more than the default 5 seconds.
setDefaultTimeout(120_000);

const db = getDb();
const TOTAL = 60;

beforeAll(async () => {
  await resetTables();
  const tools = await insertCategory("tools", "Tools");
  const toys = await insertCategory("toys", "Toys");
  // Few distinct prices, ratings and dates, so every sort has many ties to break.
  await insertProducts(
    Array.from({ length: TOTAL }, (_, i) => ({
      title: i % 2 === 0 ? `Widget number ${i}` : `Gadget ${i}`,
      description: i % 2 === 0 ? "A plain part" : "Fits any widget",
      categoryId: i % 3 === 0 ? toys : tools,
      priceCents: 500 + (i % 5) * 100,
      ratingAvg: 3 + (i % 4) * 0.5,
      createdAt: new Date(Date.UTC(2026, 0, 1 + (i % 3))),
    })),
  );
});

const priceAsc: KeysetSort = { key: "price-asc", value: products.priceCents, id: products.id, cast: "integer", direction: "ASC" };
const ratingDesc: KeysetSort = { key: "rating", value: products.ratingAvg, id: products.id, cast: "numeric", direction: "DESC" };
const newest: KeysetSort = { key: "newest", value: products.createdAt, id: products.id, cast: "timestamptz", direction: "DESC" };
const widgetQuery = sql`websearch_to_tsquery('english', 'widget')`;
const relevance: KeysetSort = {
  key: "relevance",
  value: sql`ts_rank(${products.search}, ${widgetQuery})`,
  id: products.id,
  cast: "float4",
  direction: "DESC",
};
const isWidget = sql`${products.search} @@ ${widgetQuery}`;

type Row = { id: number; priceCents: number };
type Options = Omit<KeysetOptions, "after" | "before">;

/** One page of products, read through the module the way a list query does. */
function page(options: KeysetOptions): Promise<KeysetResult<Row>> {
  return keysetPage(options, (keyset) =>
    db
      .select({ id: products.id, priceCents: products.priceCents, cursorValue: keyset.cursorValue })
      .from(products)
      .where(keyset.where)
      .orderBy(...keyset.orderBy)
      .limit(keyset.limit),
  );
}

async function walkForward(options: Options): Promise<KeysetResult<Row>[]> {
  const pages: KeysetResult<Row>[] = [];
  let after: string | undefined;
  do {
    const next = await page({ ...options, after });
    pages.push(next);
    after = next.nextCursor ?? undefined;
    if (pages.length > 20) throw new Error("Forward walk did not end");
  } while (after);
  return pages;
}

async function walkBackward(options: Options, from: KeysetResult<Row>): Promise<KeysetResult<Row>[]> {
  const pages: KeysetResult<Row>[] = [from];
  let before = from.prevCursor ?? undefined;
  while (before) {
    const previous = await page({ ...options, before });
    pages.unshift(previous);
    before = previous.prevCursor ?? undefined;
    if (pages.length > 20) throw new Error("Backward walk did not end");
  }
  return pages;
}

const ids = (pages: KeysetResult<Row>[]) => pages.map((p) => p.rows.map((row) => row.id));

/** The whole list in one read, with no paging: what the pages must add up to. */
async function unpaged({ sort, filters }: Options): Promise<number[]> {
  const direction = sort.direction === "ASC" ? asc : desc;
  const rows = await db
    .select({ id: products.id })
    .from(products)
    .where(filters)
    .orderBy(direction(sort.value), direction(sort.id));
  return rows.map((row) => row.id);
}

const inTools = (): SQL =>
  eq(products.categoryId, sql`(SELECT id FROM categories WHERE slug = 'tools')`);

const cases: Array<{ name: string; options: () => Options; total: number }> = [
  { name: "integer, ascending", options: () => ({ sort: priceAsc }), total: TOTAL },
  { name: "numeric, descending", options: () => ({ sort: ratingDesc }), total: TOTAL },
  { name: "timestamptz, descending", options: () => ({ sort: newest }), total: TOTAL },
  { name: "float4 rank, with the caller's filter", options: () => ({ sort: relevance, filters: isWidget }), total: TOTAL },
  { name: "integer, within one category", options: () => ({ sort: priceAsc, filters: inTools() }), total: 40 },
];

describe("keyset page", () => {
  for (const { name, options, total } of cases) {
    describe(name, () => {
      test("walking forward returns every row once, in sort order with ties broken by id", async () => {
        const pages = await walkForward(options());
        const seen = ids(pages).flat();
        expect(seen).toHaveLength(total);
        expect(new Set(seen).size).toBe(total);
        expect(seen).toEqual(await unpaged(options()));
        expect(pages.map((p) => p.rows.length)).toEqual(
          Array.from({ length: Math.ceil(total / PAGE_SIZE) }, (_, i) => Math.min(PAGE_SIZE, total - i * PAGE_SIZE)),
        );
        expect(pages[0].prevCursor).toBeNull();
        expect(pages[pages.length - 1].nextCursor).toBeNull();
      });

      test("walking backward from the last page returns the same pages", async () => {
        const forward = await walkForward(options());
        const backward = await walkBackward(options(), forward[forward.length - 1]);
        expect(ids(backward)).toEqual(ids(forward));
        expect(backward[0].prevCursor).toBeNull();
      });
    });
  }

  const cursor = (...parts: unknown[]) => Buffer.from(JSON.stringify(parts)).toString("base64url");

  test("treats a cursor it cannot read as the first page", async () => {
    const first = await page({ sort: priceAsc });
    const unreadable = [
      "not-a-cursor",
      cursor("price-asc", "1; DROP TABLE products", 1),
      cursor("price-asc", "2026-01-01", 1),
      cursor("price-asc", "500", -1),
      // The format before the sort key was added.
      cursor("500", 1),
    ];
    for (const after of unreadable) {
      const result = await page({ sort: priceAsc, after });
      expect(result.rows.map((r) => r.id)).toEqual(first.rows.map((r) => r.id));
      expect(result.prevCursor).toBeNull();
    }
  });

  test("treats a cursor from a different sort as the first page", async () => {
    const first = await page({ sort: priceAsc });
    const byRating = await page({ sort: ratingDesc });
    // A rating such as "4.5" has a shape a price cursor could not tell apart from a number.
    const result = await page({ sort: priceAsc, after: byRating.nextCursor! });
    expect(result.rows.map((r) => r.id)).toEqual(first.rows.map((r) => r.id));
  });

  test("keeps the page size between 1 and 24, whatever limit is asked for", async () => {
    const sizes = [];
    for (const limit of [0, 6, 99]) {
      const result = await page({ sort: priceAsc, limit });
      sizes.push(result.rows.length);
      expect(result.nextCursor).not.toBeNull();
    }
    expect(sizes).toEqual([1, 6, 24]);
  });
});
