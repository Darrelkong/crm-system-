export const dynamic = "force-dynamic";

import { sql } from "drizzle-orm";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getDb } from "@/lib/db";

/** Always required foundation tables. */
const CORE_EXPECTED_TABLES = [
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

/**
 * Tables required only after their introducing migration is present.
 * Avoids noisy failures on local DBs that have not yet applied 0041.
 */
const MIGRATION_GATED_TABLES = [
  {
    table: "customer_contact_identifiers",
    migrationNamePrefix: "0041_create_customer_contact_identifiers",
  },
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
    const tableSet = new Set(tables);

    const missingTables: string[] = CORE_EXPECTED_TABLES.filter(
      (table) => !tableSet.has(table),
    );

    let appliedMigrations: string[] = [];
    if (tableSet.has("d1_migrations")) {
      const migrationRows = await env.DB.prepare(
        `SELECT name FROM d1_migrations`,
      ).all();
      appliedMigrations = (
        (migrationRows.results as { name: string }[] | undefined) ?? []
      ).map((row) => row.name);
    }

    for (const gated of MIGRATION_GATED_TABLES) {
      const migrationApplied = appliedMigrations.some((name) =>
        name.startsWith(gated.migrationNamePrefix),
      );
      // Production deploy is ordered after 0041; require table whenever
      // migration is recorded OR (in production) always once core is healthy.
      if (migrationApplied || isProduction) {
        if (!tableSet.has(gated.table)) {
          missingTables.push(gated.table);
        }
      }
    }

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
