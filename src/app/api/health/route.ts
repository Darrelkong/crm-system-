export const dynamic = "force-dynamic";

import { sql } from "drizzle-orm";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getDb } from "@/lib/db";

const EXPECTED_TABLES = [
  "users",
  "sessions",
  "customers",
  "customer_contacts",
  "follow_ups",
  "tasks",
  "audit_logs",
  "login_logs",
  "system_settings",
] as const;

const isProduction = process.env.NODE_ENV === "production";

export async function GET() {
  try {
    const db = getDb();
    await db.run(sql`SELECT 1`);

    const { env } = getCloudflareContext();
    const { results } = await env.DB.prepare(
      `SELECT name FROM sqlite_master
       WHERE type = 'table'
         AND name NOT LIKE 'sqlite_%'
         AND name NOT LIKE '_cf_%'
       ORDER BY name`,
    ).all();

    const tables = (results as { name: string }[]).map((row) => row.name);
    const missingTables = EXPECTED_TABLES.filter(
      (table) => !tables.includes(table),
    );

    if (isProduction) {
      if (missingTables.length > 0) {
        return Response.json({ status: "error" }, { status: 503 });
      }
      return Response.json({ status: "ok" });
    }

    return Response.json({
      status: missingTables.length === 0 ? "ok" : "degraded",
      database: "d1",
      tables,
      missingTables,
      phase: 0,
    });
  } catch {
    if (isProduction) {
      return Response.json({ status: "error" }, { status: 503 });
    }

    return Response.json(
      {
        status: "error",
        database: "d1",
        message: "Database health check failed",
        phase: 0,
      },
      { status: 503 },
    );
  }
}
