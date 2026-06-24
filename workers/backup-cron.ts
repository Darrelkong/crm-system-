/// <reference types="@cloudflare/workers-types" />

import { drizzle } from "drizzle-orm/d1";
import * as schema from "../drizzle/schema";
import { runDatabaseBackup } from "../src/lib/backup/engine";

export interface Env {
  DB: D1Database;
  ATTACHMENTS: R2Bucket;
}

/**
 * Standalone Cloudflare Worker for daily scheduled database backup.
 * Cron: 0 21 * * * UTC = 05:00 Asia/Shanghai (UTC+8)
 * Deploy with: npm run cron:backup:deploy
 */
export default {
  async scheduled(
    _event: ScheduledEvent,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    const db = drizzle(env.DB, { schema });

    ctx.waitUntil(
      runDatabaseBackup({
        db,
        r2: env.ATTACHMENTS,
        backupType: "scheduled",
        triggeredBy: null,
        environment: "production",
      })
        .then((result) => {
          console.log("[backup-cron] completed", JSON.stringify(result));
        })
        .catch((error) => {
          console.error("[backup-cron] failed", error);
        }),
    );
  },
};
