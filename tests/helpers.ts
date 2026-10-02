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

export async function insertProduct(p: ProductFixture): Promise<number> {
  fixtureCount += 1;
  const { rows } = await getPool().query<{ id: number }>(
    `INSERT INTO products (slug, title, description, category_id, price_cents, stock, rating_avg, rating_count, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
    [
      p.slug ?? `fixture-${fixtureCount}`,
      p.title,
      p.description ?? "",
      p.categoryId,
      p.priceCents ?? 1000,
      p.stock ?? 10,
      p.ratingAvg ?? 4,
      p.ratingCount ?? 10,
      p.createdAt ?? new Date("2026-01-01T00:00:00Z"),
    ],
  );
  return rows[0].id;
}
