import { rootCertificates } from "node:tls";
import { type ClientBase, Pool, types } from "pg";
import { SUPABASE_ROOT_CA } from "./supabase-ca";

// Ids are bigint in Postgres and stay far below 2^53, so plain numbers are safe.
types.setTypeParser(types.builtins.INT8, (value) => Number(value));

/**
 * DB_SEARCH_PATH is set only by the test setup ("test,public"). It needs the
 * session connection: the transaction pooler hands one server connection to
 * many clients, so a search_path set there would leak into other queries.
 */
function poolConfig(direct: boolean) {
  const searchPath = process.env.DB_SEARCH_PATH;
  const pooled = process.env.SUPABASE_POSTGRES_URL;
  const session = process.env.SUPABASE_POSTGRES_URL_NON_POOLING ?? pooled;
  const connectionString = direct || searchPath ? session : pooled;
  if (!connectionString) {
    throw new Error("SUPABASE_POSTGRES_URL is not set. Run `vercel env pull` to refresh .env.local.");
  }
  // node-postgres lets sslmode in the connection string override the `ssl` option,
  // so take it out of the string and state the TLS settings here instead.
  const url = new URL(connectionString);
  const sslmode = url.searchParams.get("sslmode");
  url.searchParams.delete("sslmode");
  return {
    connectionString: url.toString(),
    // Verify the certificate and the host name, against the system roots plus Supabase's own root.
    ssl: sslmode && sslmode !== "disable" ? { ca: [...rootCertificates, SUPABASE_ROOT_CA] } : false,
    max: 10,
    // Fail with an error the page can show, rather than hang, when the database is unreachable.
    connectionTimeoutMillis: 8_000,
    query_timeout: 10_000,
    idleTimeoutMillis: 30_000,
    // The pool waits for this before it hands out a new connection, and drops the connection if it fails.
    ...(searchPath
      ? { onConnect: async (client: ClientBase) => void (await client.query(`SET search_path TO ${searchPath}`)) }
      : {}),
  };
}

const globalForDb = globalThis as unknown as { stockroomPool?: Pool };

/** Pool for the running app. Reused across hot reloads and warm invocations. */
export function getPool(): Pool {
  globalForDb.stockroomPool ??= new Pool(poolConfig(false));
  return globalForDb.stockroomPool;
}

/** Session pool for migrations and the seed script. The caller ends it. */
export function createDirectPool(): Pool {
  return new Pool(poolConfig(true));
}
