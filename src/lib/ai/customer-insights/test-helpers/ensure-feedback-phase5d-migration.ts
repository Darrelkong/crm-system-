import { readFileSync } from "node:fs";

type D1Like = {
  prepare: (query: string) => {
    first: <T>() => Promise<T | null>;
    run: () => Promise<unknown>;
  };
};

/**
 * TEST-ONLY helper for local getPlatformProxy suites.
 * Prefer official `wrangler d1 migrations apply crm-db --local` when possible.
 * Never import from production routes, services, or Worker startup.
 */
export async function ensureAiInsightFeedbackPhase5dMigrationForTests(
  d1: D1Like,
): Promise<void> {
  const probe = await d1
    .prepare(
      "SELECT COUNT(*) AS c FROM pragma_table_info('ai_insight_feedback') WHERE name = 'generation_key'",
    )
    .first<{ c: number }>();
  if ((probe?.c ?? 0) > 0) {
    return;
  }

  const sql = readFileSync(
    "drizzle/migrations/0037_ai_insight_feedback_phase5d.sql",
    "utf8",
  );
  const statements = sql
    .split(";")
    .map((part) =>
      part
        .split("\n")
        .filter((line) => !line.trim().startsWith("--"))
        .join("\n")
        .trim(),
    )
    .filter((part) => part.length > 0);

  for (const statement of statements) {
    await d1.prepare(statement).run();
  }
}
