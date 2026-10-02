import { existsSync, readFileSync } from "node:fs";

// Runs once before the test files. Tests use a real Postgres database, in a
// schema named `test`, and never touch the schema the app reads (SPEC.md 3.1).

// `bun test` sets NODE_ENV=test, and Bun then skips .env.local, so read it here.
if (!process.env.SUPABASE_POSTGRES_URL && existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]] !== undefined) continue;
    process.env[match[1]] = match[2].replace(/^(["'])(.*)\1$/, "$2");
  }
}

if (!process.env.SUPABASE_POSTGRES_URL) {
  throw new Error("Tests need SUPABASE_POSTGRES_URL (see .env.example). Run `vercel env pull` first.");
}

// Every pool created after this line sees only `test`, then `public` for extensions.
process.env.DB_SEARCH_PATH = "test,public";

const { createDirectPool, getPool } = await import("../src/db/client");
const { migrate } = await import("../src/db/migrate");

const admin = createDirectPool();
await admin.query("DROP SCHEMA IF EXISTS test CASCADE");
await admin.query("CREATE SCHEMA test");
await admin.end();

// Stop here rather than let a test write to the app's tables.
const { rows } = await getPool().query<{ schema: string }>("SELECT current_schema() AS schema");
if (rows[0].schema !== "test") {
  throw new Error(`Tests must run in the test schema, but the connection is in "${rows[0].schema}".`);
}

await migrate(getPool());
