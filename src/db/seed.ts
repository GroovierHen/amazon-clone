import type { Pool } from "pg";
import { buildCatalog } from "../../seed/catalog";

/**
 * Loads the catalog. Safe to run again: categories and products are matched on
 * slug and updated in place, which also puts stock back to its seed value.
 * Carts and orders are left alone.
 */
export async function seed(pool: Pool): Promise<{ categories: number; products: number }> {
  const { categories, products } = buildCatalog();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const categoryIds = new Map<string, number>();
    for (const c of categories) {
      const { rows } = await client.query<{ id: number }>(
        `INSERT INTO categories (slug, name) VALUES ($1, $2)
         ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
        [c.slug, c.name],
      );
      categoryIds.set(c.slug, rows[0].id);
    }

    for (const p of products) {
      await client.query(
        `INSERT INTO products
           (slug, title, description, category_id, price_cents, stock, rating_avg, rating_count, image_urls, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (slug) DO UPDATE SET
           title = EXCLUDED.title,
           description = EXCLUDED.description,
           category_id = EXCLUDED.category_id,
           price_cents = EXCLUDED.price_cents,
           stock = EXCLUDED.stock,
           rating_avg = EXCLUDED.rating_avg,
           rating_count = EXCLUDED.rating_count,
           image_urls = EXCLUDED.image_urls,
           created_at = EXCLUDED.created_at`,
        [
          p.slug,
          p.title,
          p.description,
          categoryIds.get(p.categorySlug),
          p.priceCents,
          p.stock,
          p.ratingAvg,
          p.ratingCount,
          p.imageUrls,
          p.createdAt,
        ],
      );
    }

    await client.query("COMMIT");
    return { categories: categories.length, products: products.length };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
