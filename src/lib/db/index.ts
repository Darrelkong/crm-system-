import { getCloudflareContext } from "@opennextjs/cloudflare";
import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import { cache } from "react";
import * as schema from "../../../drizzle/schema";

export type Database = DrizzleD1Database<typeof schema>;

/**
 * Returns a request-scoped Drizzle client bound to the Cloudflare D1 `DB` binding.
 * Use in Server Components and synchronous route handlers.
 */
export const getDb = cache((): Database => {
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
