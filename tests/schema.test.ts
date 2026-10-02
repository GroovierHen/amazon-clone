import { beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { getPool } from "../src/db/client";
import { migrate } from "../src/db/migrate";
import { seed } from "../src/db/seed";
import { insertCategory, insertProduct, resetTables } from "./helpers";

// The database is remote: a test with many round trips needs more than the default 5 seconds.
setDefaultTimeout(120_000);

const pool = getPool();

describe("migrations", () => {
  test("build every table in the test schema", async () => {
    const { rows } = await pool.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'test' ORDER BY table_name",
    );
    expect(rows.map((r) => r.table_name)).toEqual([
      "cart_items",
      "carts",
      "categories",
      "order_items",
      "orders",
      "products",
      "schema_migrations",
    ]);
  });

  test("create the indexes from SPEC.md section 4", async () => {
    const { rows } = await pool.query<{ indexname: string }>(
      "SELECT indexname FROM pg_indexes WHERE schemaname = 'test'",
    );
    const names = rows.map((r) => r.indexname);
    for (const expected of [
      "products_search_idx",
      "products_title_trgm_idx",
      "products_price_idx",
      "products_created_idx",
      "products_rating_idx",
      "products_category_idx",
      "orders_visitor_idx",
    ]) {
      expect(names).toContain(expected);
    }
  });

  test("apply nothing the second time", async () => {
    expect(await migrate(pool)).toEqual([]);
  });
});

describe("constraints", () => {
  let categoryId: number;
  let productId: number;

  beforeAll(async () => {
    await resetTables();
    categoryId = await insertCategory("tools", "Tools");
    productId = await insertProduct({ title: "Claw Hammer", description: "Steel head, ash handle", categoryId });
  });

  test("reject negative stock", async () => {
    expect(pool.query("UPDATE products SET stock = -1 WHERE id = $1", [productId])).rejects.toThrow(
      /products_stock_check/,
    );
  });

  test("reject a cart quantity of zero", async () => {
    const { rows } = await pool.query<{ id: string }>(
      "INSERT INTO carts (visitor_id) VALUES (gen_random_uuid()) RETURNING id",
    );
    expect(
      pool.query("INSERT INTO cart_items (cart_id, product_id, quantity) VALUES ($1, $2, 0)", [
        rows[0].id,
        productId,
      ]),
    ).rejects.toThrow(/cart_items_quantity_check/);
  });

  test("generate the search vector with title above description", async () => {
    const { rows } = await pool.query<{ search: string }>("SELECT search::text FROM products WHERE id = $1", [
      productId,
    ]);
    expect(rows[0].search).toContain("'hammer':2A");
    expect(rows[0].search).toContain("'steel':3B");
  });
});

describe("seed", () => {
  test("loads at least 200 products across 8 categories and can run twice", async () => {
    await resetTables();
    const first = await seed(pool);
    const second = await seed(pool);
    expect(second).toEqual(first);

    const { rows } = await pool.query<{ products: number; categories: number }>(
      "SELECT count(*)::int AS products, count(DISTINCT category_id)::int AS categories FROM products",
    );
    expect(rows[0].products).toBe(first.products);
    expect(rows[0].products).toBeGreaterThanOrEqual(200);
    expect(rows[0].categories).toBe(8);
  });
});
