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

    await client.query(
      `INSERT INTO categories (slug, name)
       SELECT x.slug, x.name FROM jsonb_to_recordset($1::jsonb) AS x(slug text, name text)
       ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name`,
      [JSON.stringify(categories)],
    );

    // One statement for the whole catalog, so seeding a remote database takes one round trip.
    await client.query(
      `INSERT INTO products
         (slug, title, description, category_id, price_cents, stock, rating_avg, rating_count, image_urls, created_at)
       SELECT x.slug, x.title, x.description, c.id, x.price_cents, x.stock, x.rating_avg, x.rating_count,
              x.image_urls, x.created_at
       FROM jsonb_to_recordset($1::jsonb) AS x(
         slug text, title text, description text, category_slug text, price_cents integer, stock integer,
         rating_avg numeric, rating_count integer, image_urls text[], created_at timestamptz
       )
       JOIN categories c ON c.slug = x.category_slug
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
        JSON.stringify(
          products.map((p) => ({
            slug: p.slug,
            title: p.title,
            description: p.description,
            category_slug: p.categorySlug,
            price_cents: p.priceCents,
            stock: p.stock,
            rating_avg: p.ratingAvg,
            rating_count: p.ratingCount,
            image_urls: p.imageUrls,
            created_at: p.createdAt.toISOString(),
          })),
        ),
      ],
    );

    await client.query("COMMIT");
    return { categories: categories.length, products: products.length };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
