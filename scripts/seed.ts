import { createDirectPool } from "../src/db/client";
import { seed } from "../src/db/seed";

const pool = createDirectPool();
try {
  const { categories, products } = await seed(pool);
  console.log(`Seeded ${products} products in ${categories} categories.`);
} finally {
  await pool.end();
}
