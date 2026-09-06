/// <reference types="@cloudflare/workers-types" />

import { drizzle } from "drizzle-orm/d1";
import * as schema from "../drizzle/schema";
import { runReclamationCheck } from "../src/lib/reclamation/engine";
import { runCollaborationFollowUpReminderCheck } from "../src/lib/customers/collaboration-reminders";

export interface Env {
  DB: D1Database;
}

/**
 * Standalone Cloudflare Worker scheduled handler for daily auto-reclamation.
 * Cron: 0 21 * * * UTC = 05:00 Asia/Hong_Kong (UTC+8)
 * Deploy with: npm run cron:deploy
 */
const worker = {
  async scheduled(
    _event: ScheduledEvent,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    const db = drizzle(env.DB, { schema });

    const now = new Date();
    ctx.waitUntil(
      Promise.all([
        runReclamationCheck(db, now).then((result) => {
          console.log("[reclamation-cron] completed", JSON.stringify(result));
        }),
        runCollaborationFollowUpReminderCheck(db, now).then((result) => {
          console.log(
            "[collaboration-reminders] completed",
            JSON.stringify(result),
          );
        }),
      ]).catch((error) => {
        console.error("[reclamation-cron] scheduled work failed", error);
      }),
    );
  },
};

export default worker;
