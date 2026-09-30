import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "@/db/schema";

declare global {
  var loopnowPool: Pool | undefined;
}

function databaseUrl(): string {
  const value = process.env.DATABASE_URL;
  if (!value) {
    throw new Error("DATABASE_URL is required for database access");
  }
  return value;
}

export function getDb() {
  const pool = globalThis.loopnowPool ?? new Pool({ connectionString: databaseUrl() });
  // A process-wide pool is required in production as well: creating one per
  // repository call leaks connections under load. The global is scoped to a
  // single server process/serverless warm instance, not shared across tenants.
  globalThis.loopnowPool = pool;
  return drizzle({ client: pool, schema });
}

export async function checkDatabaseConnection(): Promise<void> {
  const db = getDb();
  await db.execute("select 1");
}
