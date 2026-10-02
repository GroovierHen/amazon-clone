import { Pool, types } from "pg";

// Ids are bigint in Postgres and stay far below 2^53, so plain numbers are safe.
types.setTypeParser(types.builtins.INT8, (value) => Number(value));

/**
 * DB_SEARCH_PATH is set only by the test setup ("test,public"). It needs a
 * direct connection, because the pooled endpoint ignores startup options.
 */
function poolConfig(direct: boolean) {
  const searchPath = process.env.DB_SEARCH_PATH;
  const pooled = process.env.DATABASE_URL;
  const unpooled = process.env.DATABASE_URL_UNPOOLED ?? pooled;
  const connectionString = direct || searchPath ? unpooled : pooled;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set. Run `vercel env pull` to refresh .env.local.");
  }
  return {
    // node-postgres already verifies the certificate for sslmode=require, and warns
    // that this will change in its next major version. Asking for it by name keeps
    // the check and drops the warning.
    connectionString: connectionString.replace("sslmode=require", "sslmode=verify-full"),
    max: 10,
    // Fail with an error the page can show, rather than hang, when the database is unreachable.
    connectionTimeoutMillis: 8_000,
    query_timeout: 10_000,
    idleTimeoutMillis: 30_000,
    ...(searchPath ? { options: `-c search_path=${searchPath}` } : {}),
  };
}

const globalForDb = globalThis as unknown as { stockroomPool?: Pool };

/** Pool for the running app. Reused across hot reloads and warm invocations. */
export function getPool(): Pool {
  globalForDb.stockroomPool ??= new Pool(poolConfig(false));
  return globalForDb.stockroomPool;
}

/** Direct, unpooled pool for migrations and the seed script. The caller ends it. */
export function createDirectPool(): Pool {
  return new Pool(poolConfig(true));
}
