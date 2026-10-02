import { getPool } from "../src/db/client";

/** Empties every table in the test schema. Refuses to run anywhere else. */
export async function resetTables(): Promise<void> {
  const pool = getPool();
  const { rows } = await pool.query<{ schema: string }>("SELECT current_schema() AS schema");
  if (rows[0].schema !== "test") {
    throw new Error(`Refusing to truncate: current schema is "${rows[0].schema}", not "test"`);
  }
  await pool.query(
    "TRUNCATE order_items, orders, cart_items, carts, products, categories RESTART IDENTITY CASCADE",
  );
}

export type ProductFixture = {
  slug?: string;
  title: string;
  description?: string;
  categoryId: number;
  priceCents?: number;
  stock?: number;
  ratingAvg?: number;
  ratingCount?: number;
  createdAt?: Date;
};

export async function insertCategory(slug: string, name = slug): Promise<number> {
  const { rows } = await getPool().query<{ id: number }>(
    "INSERT INTO categories (slug, name) VALUES ($1, $2) RETURNING id",
    [slug, name],
  );
  return rows[0].id;
}

let fixtureCount = 0;

/** Inserts many products in one statement and returns their ids in the same order. */
export async function insertProducts(products: ProductFixture[]): Promise<number[]> {
  const rows = products.map((p) => {
    fixtureCount += 1;
    return {
      n: fixtureCount,
      slug: p.slug ?? `fixture-${fixtureCount}`,
      title: p.title,
      description: p.description ?? "",
      category_id: p.categoryId,
      price_cents: p.priceCents ?? 1000,
      stock: p.stock ?? 10,
      rating_avg: p.ratingAvg ?? 4,
      rating_count: p.ratingCount ?? 10,
      created_at: (p.createdAt ?? new Date("2026-01-01T00:00:00Z")).toISOString(),
    };
  });
  // Ordered by n, so identity ids are handed out in fixture order.
  await getPool().query(
    `INSERT INTO products (slug, title, description, category_id, price_cents, stock, rating_avg, rating_count, created_at)
     SELECT x.slug, x.title, x.description, x.category_id, x.price_cents, x.stock, x.rating_avg, x.rating_count, x.created_at
     FROM jsonb_to_recordset($1::jsonb) AS x(
       n integer, slug text, title text, description text, category_id integer, price_cents integer,
       stock integer, rating_avg numeric, rating_count integer, created_at timestamptz
     )
     ORDER BY x.n`,
    [JSON.stringify(rows)],
  );
  const { rows: inserted } = await getPool().query<{ id: number; slug: string }>(
    "SELECT id, slug FROM products WHERE slug = ANY($1::text[])",
    [rows.map((r) => r.slug)],
  );
  const idBySlug = new Map(inserted.map((r) => [r.slug, r.id]));
  return rows.map((r) => idBySlug.get(r.slug)!);
}

export async function insertProduct(p: ProductFixture): Promise<number> {
  return (await insertProducts([p]))[0];
}
