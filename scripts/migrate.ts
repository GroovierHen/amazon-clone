import { createDirectPool } from "../src/db/client";
import { migrate } from "../src/db/migrate";

const pool = createDirectPool();
try {
  const applied = await migrate(pool);
  console.log(applied.length ? `Applied: ${applied.join(", ")}` : "Nothing to apply. Database is up to date.");
} finally {
  await pool.end();
}
