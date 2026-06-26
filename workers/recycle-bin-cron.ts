/// <reference types="@cloudflare/workers-types" />

import { drizzle } from "drizzle-orm/d1";
import * as schema from "../drizzle/schema";
import { purgeExpiredRecycleBinCustomers } from "../src/lib/recycle-bin/service";

export interface Env {
  DB: D1Database;
}

/**
 * Standalone Cloudflare Worker for daily recycle-bin purge (90-day retention).
 * Cron: 30 21 * * * UTC = 05:30 Asia/Shanghai (UTC+8), after backup/reclamation crons.
 * Deploy with: npm run cron:recycle:deploy
 */
export default {
  async scheduled(
    _event: ScheduledEvent,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    const db = drizzle(env.DB, { schema });

    ctx.waitUntil(
      purgeExpiredRecycleBinCustomers(db)
        .then((result) => {
          console.log("[recycle-bin-cron] completed", JSON.stringify(result));
        })
        .catch((error) => {
          console.error("[recycle-bin-cron] failed", error);
        }),
    );
  },
};
