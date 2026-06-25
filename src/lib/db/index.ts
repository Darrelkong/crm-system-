import { getCloudflareContext } from "@opennextjs/cloudflare";
import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import { cache } from "react";
import * as schema from "../../../drizzle/schema";

export type Database = DrizzleD1Database<typeof schema>;

let testDatabase: Database | null = null;

/**
 * Used only by local verification scripts (`scripts/verify-phase-18e-local.ts`).
 * Requires `CRM_ALLOW_TEST_DB_BIND=1` — never set in Cloudflare production.
 */
export function bindTestDatabase(db: Database | null): void {
  if (process.env.CRM_ALLOW_TEST_DB_BIND !== "1") {
    throw new Error("bindTestDatabase is disabled outside local verification");
  }
  testDatabase = db;
}

/**
 * Returns a request-scoped Drizzle client bound to the Cloudflare D1 `DB` binding.
 * Use in Server Components and synchronous route handlers.
 */
export const getDb = cache((): Database => {
  if (testDatabase) {
    return testDatabase;
  }
  const { env } = getCloudflareContext();
  return drizzle(env.DB, { schema });
});

/**
 * Returns a request-scoped Drizzle client for async contexts (e.g. static routes).
 */
export const getDbAsync = cache(async (): Promise<Database> => {
  const { env } = await getCloudflareContext({ async: true });
  return drizzle(env.DB, { schema });
});

export { schema };
