/// <reference types="@cloudflare/workers-types" />

import { drizzle } from "drizzle-orm/d1";
import * as schema from "../drizzle/schema";
import { runReclamationCheck } from "../src/lib/reclamation/engine";

export interface Env {
  DB: D1Database;
}

/**
 * Standalone Cloudflare Worker scheduled handler for daily auto-reclamation.
 * Deploy with: npm run cron:deploy
 */
export default {
  async scheduled(
    _event: ScheduledEvent,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    const db = drizzle(env.DB, { schema });

    ctx.waitUntil(
      runReclamationCheck(db, new Date())
        .then((result) => {
          console.log("[reclamation-cron] completed", JSON.stringify(result));
        })
        .catch((error) => {
          console.error("[reclamation-cron] failed", error);
        }),
    );
  },
};
