import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { getPool } from "./client";
import * as schema from "./schema";

export type Db = NodePgDatabase<typeof schema>;

const globalForDb = globalThis as unknown as { stockroomDb?: Db };

/** Drizzle over the app's pool. Reused across hot reloads and warm invocations, like the pool. */
export function getDb(): Db {
  globalForDb.stockroomDb ??= drizzle(getPool(), { schema });
  return globalForDb.stockroomDb;
}
