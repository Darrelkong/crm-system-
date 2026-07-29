import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "../../../drizzle/schema";
import { bindTestDatabase } from "@/lib/db";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { buildAiInsightGenerationKey } from "@/lib/ai/customer-insights/feedback-generation-key";
import { ensureAiInsightFeedbackPhase5dMigrationForTests } from "@/lib/ai/customer-insights/test-helpers/ensure-feedback-phase5d-migration";
import { ALLOWED_EXPORT_FIELDS } from "@/lib/export/customers/constants";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  BACKUP_EXCLUDED_FIELDS,
  BACKUP_TABLE_NAMES,
} from "./constants";
import {
  collectBackupTableData,
  countBackupRecords,
} from "./export-data";

const NEW_BACKUP_TABLES = [
  "customer_assignees",
  "customer_tags",
  "customer_ai_insights",
  "ai_insight_feedback",
  "announcements",
  "customer_code_counter",
  "login_ip_email_restrictions",
  "customer_contact_identifiers",
] as const;

const CORE_BACKUP_TABLES = [
  "customers",
  "follow_ups",
  "tasks",
  "approvals",
  "notifications",
  "audit_logs",
] as const;

describe("backup export table coverage", () => {
  it("includes newly added CRM tables", () => {
    for (const name of NEW_BACKUP_TABLES) {
      assert.equal(
        (BACKUP_TABLE_NAMES as readonly string[]).includes(name),
        true,
        `missing table: ${name}`,
      );
    }
  });

  it("includes core business tables", () => {
    for (const name of CORE_BACKUP_TABLES) {
      assert.equal(
        (BACKUP_TABLE_NAMES as readonly string[]).includes(name),
        true,
        `missing table: ${name}`,
      );
    }
  });

  it("does not include sessions table", () => {
    assert.equal(
      (BACKUP_TABLE_NAMES as readonly string[]).includes("sessions"),
      false,
    );
  });

  it("excludes users.password_hash from backup field policy", () => {
    assert.deepEqual(BACKUP_EXCLUDED_FIELDS.users, ["password_hash"]);
  });

  it("counts records across all backup tables", () => {
    const tables = Object.fromEntries(
      BACKUP_TABLE_NAMES.map((name) => [name, [{ id: "1" }]]),
    ) as Record<(typeof BACKUP_TABLE_NAMES)[number], { id: string }[]>;

    const counts = countBackupRecords(tables);
    assert.equal(counts.tableCount, BACKUP_TABLE_NAMES.length);
    assert.equal(counts.recordCount, BACKUP_TABLE_NAMES.length);
  });

  it("orders ai_insight_feedback after parent FK tables for restore safety", () => {
    const names = BACKUP_TABLE_NAMES as readonly string[];
    const usersIdx = names.indexOf("users");
    const customersIdx = names.indexOf("customers");
    const insightsIdx = names.indexOf("customer_ai_insights");
    const feedbackIdx = names.indexOf("ai_insight_feedback");

    assert.ok(usersIdx >= 0);
    assert.ok(customersIdx > usersIdx);
    assert.ok(insightsIdx > customersIdx);
    assert.ok(feedbackIdx > insightsIdx);
  });

  it("does not include ai_insight_feedback in ordinary Customer Export allowlist", () => {
    const exportFields = ALLOWED_EXPORT_FIELDS as readonly string[];
    assert.equal(exportFields.includes("ai_insight_feedback"), false);
    assert.equal(exportFields.includes("feedback"), false);
    assert.equal(exportFields.includes("rating"), false);
    assert.equal(exportFields.includes("comment"), false);
    assert.equal(exportFields.includes("generation_key"), false);
  });

  it("does not add ai_insight_feedback to health CORE_EXPECTED_TABLES (foundation-only)", () => {
    const healthSrc = readFileSync(
      join(process.cwd(), "src/app/api/health/route.ts"),
      "utf8",
    );
    assert.match(healthSrc, /CORE_EXPECTED_TABLES/);
    // Same class as customer_ai_insights: backed up, not foundation health-gated.
    assert.equal(healthSrc.includes("ai_insight_feedback"), false);
    assert.equal(healthSrc.includes("customer_ai_insights"), false);
  });

  it("backup engine metadata logs only counts, not feedback row bodies", () => {
    const engineSrc = readFileSync(
      join(process.cwd(), "src/lib/backup/engine.ts"),
      "utf8",
    );
    assert.match(engineSrc, /tableCount/);
    assert.match(engineSrc, /recordCount/);
    assert.equal(engineSrc.includes("reason_tags_json"), false);
    assert.equal(engineSrc.includes("generation_key"), false);
    assert.doesNotMatch(engineSrc, /comment.*metadata/);
  });
});

describe(
  "collectBackupTableData integration",
  { skip: process.env.CRM_ALLOW_TEST_DB_BIND !== "1" },
  () => {
    let db: ReturnType<typeof drizzle<typeof schema>>;
    let dispose: (() => Promise<void>) | undefined;

    const TEST_INSIGHT_ID = "ai999999-9999-9999-9999-backupfb0001";
    const TEST_CUSTOMER_ID = SEED_IDS.customerStaffA;
    const GENERATED_AT = "2026-07-29T07:00:00.000Z";
    const SOURCE_HASH = "backup-feedback-source-hash";
    const GENERATION_KEY = buildAiInsightGenerationKey({
      aiInsightId: TEST_INSIGHT_ID,
      insightGeneratedAt: GENERATED_AT,
      sourceHash: SOURCE_HASH,
    });
    const FB_BASE_ID = "fb-backup-base-deep-0001";
    const FB_MSG_ID = "fb-backup-suggested-msg-0001";
    const SAFE_COMMENT = "BACKUP_TEST_COMMENT_NO_PII";

    async function deleteFixtures() {
      await db
        .delete(schema.aiInsightFeedback)
        .where(eq(schema.aiInsightFeedback.customerId, TEST_CUSTOMER_ID));
      await db
        .delete(schema.customerAiInsights)
        .where(eq(schema.customerAiInsights.customerId, TEST_CUSTOMER_ID));
    }

    before(async () => {
      process.env.CRM_ALLOW_TEST_DB_BIND = "1";
      const proxy = await getPlatformProxy<{
        DB: {
          prepare: (query: string) => {
            first: <T>() => Promise<T | null>;
            run: () => Promise<unknown>;
          };
        };
      }>({
        configPath: "wrangler.jsonc",
      });
      db = drizzle(proxy.env.DB, { schema });
      bindTestDatabase(db);
      dispose = proxy.dispose;
      await ensureAiInsightFeedbackPhase5dMigrationForTests(proxy.env.DB);
      await deleteFixtures();

      await db.insert(schema.customerAiInsights).values({
        id: TEST_INSIGHT_ID,
        customerId: TEST_CUSTOMER_ID,
        intentLevel: "medium",
        intentScore: 50,
        customerSummary: "Backup feedback fixture",
        currentSituation: "n/a",
        keySignalsJson: "[]",
        riskFlagsJson: "[]",
        missingInformationJson: "[]",
        nextBestAction: "Follow up",
        suggestedFollowUpAt: null,
        suggestedEmployeeMessage: "Hello",
        confidence: 0.5,
        reasoning: "fixture",
        model: "gemini-2.5-flash",
        promptVersion: "phase-1d-v1",
        sourceHash: SOURCE_HASH,
        status: "ready",
        generatedAt: GENERATED_AT,
        createdAt: "2026-07-29T06:00:00.000Z",
        updatedAt: GENERATED_AT,
        phase2Json: null,
      });

      const now = "2026-07-29T07:05:00.000Z";
      await db.insert(schema.aiInsightFeedback).values([
        {
          id: FB_BASE_ID,
          customerId: TEST_CUSTOMER_ID,
          aiInsightId: TEST_INSIGHT_ID,
          insightGeneratedAt: GENERATED_AT,
          model: "gemini-2.5-flash",
          promptVersion: "phase-1d-v1",
          sourceHash: SOURCE_HASH,
          rating: null,
          reasonTagsJson: JSON.stringify(["accurate_summary", "saves_time"]),
          comment: null,
          createdBy: SEED_IDS.staffA,
          createdAt: now,
          updatedAt: now,
          updatedBy: null,
          generationKey: GENERATION_KEY,
          feedbackTarget: "base_deep",
          ratingCode: "helpful",
          providerSnapshot: "google_gemini",
          contractModeSnapshot: "gemini_flat",
          phase2GeneratedSnapshot: false,
          actorRoleSnapshot: "staff",
          degradationReasonSnapshot: null,
        },
        {
          id: FB_MSG_ID,
          customerId: TEST_CUSTOMER_ID,
          aiInsightId: TEST_INSIGHT_ID,
          insightGeneratedAt: GENERATED_AT,
          model: "gemini-2.5-flash",
          promptVersion: "phase-1d-v1",
          sourceHash: SOURCE_HASH,
          rating: null,
          reasonTagsJson: JSON.stringify(["sounds_robotic"]),
          comment: SAFE_COMMENT,
          createdBy: SEED_IDS.staffA,
          createdAt: now,
          updatedAt: now,
          updatedBy: null,
          generationKey: GENERATION_KEY,
          feedbackTarget: "suggested_message",
          ratingCode: "not_helpful",
          providerSnapshot: "google_gemini",
          contractModeSnapshot: "gemini_flat",
          phase2GeneratedSnapshot: false,
          actorRoleSnapshot: "staff",
          degradationReasonSnapshot: null,
        },
      ]);
    });

    after(async () => {
      await deleteFixtures();
      bindTestDatabase(null);
      delete process.env.CRM_ALLOW_TEST_DB_BIND;
      await dispose?.();
    });

    it("returns every configured backup table key", async () => {
      const tables = await collectBackupTableData(db);

      for (const name of BACKUP_TABLE_NAMES) {
        assert.ok(Array.isArray(tables[name]), `expected array for ${name}`);
      }

      assert.equal(
        "sessions" in tables,
        false,
        "sessions must not appear in backup payload",
      );
    });

    it("includes newly added tables in collected payload", async () => {
      const tables = await collectBackupTableData(db);

      for (const name of NEW_BACKUP_TABLES) {
        assert.ok(Array.isArray(tables[name]), `expected array for ${name}`);
      }
    });

    it("never exports users.password_hash or token_hash fields", async () => {
      const tables = await collectBackupTableData(db);

      for (const row of tables.users) {
        assert.equal("password_hash" in row, false);
        assert.equal("token_hash" in row, false);
      }
    });

    it("exports ai_insight_feedback rows with generation identity and snapshots intact", async () => {
      const tables = await collectBackupTableData(db);
      const rows = tables.ai_insight_feedback.filter(
        (row) =>
          row.id === FB_BASE_ID ||
          row.id === FB_MSG_ID,
      );

      assert.equal(rows.length, 2);

      const byId = Object.fromEntries(rows.map((row) => [String(row.id), row]));
      const base = byId[FB_BASE_ID]!;
      const msg = byId[FB_MSG_ID]!;

      assert.equal(base.generation_key, GENERATION_KEY);
      assert.equal(base.rating_code, "helpful");
      assert.equal(base.feedback_target, "base_deep");
      assert.equal(base.model, "gemini-2.5-flash");
      assert.equal(base.prompt_version, "phase-1d-v1");
      assert.equal(base.source_hash, SOURCE_HASH);
      assert.equal(base.ai_insight_id, TEST_INSIGHT_ID);
      assert.equal(base.customer_id, TEST_CUSTOMER_ID);
      assert.equal(base.created_by, SEED_IDS.staffA);
      assert.equal(base.comment, null);
      assert.equal(base.provider_snapshot, "google_gemini");
      assert.equal(base.contract_mode_snapshot, "gemini_flat");
      assert.match(String(base.reason_tags_json), /accurate_summary/);

      assert.equal(msg.generation_key, GENERATION_KEY);
      assert.equal(msg.rating_code, "not_helpful");
      assert.equal(msg.feedback_target, "suggested_message");
      assert.equal(msg.comment, SAFE_COMMENT);
      assert.match(String(msg.reason_tags_json), /sounds_robotic/);

      const counts = countBackupRecords(tables);
      assert.equal(counts.tableCount, BACKUP_TABLE_NAMES.length);
      assert.ok(counts.recordCount >= 2);
    });
  },
);
