import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { join } from "node:path";
import en from "@/i18n/locales/en";
import zhHans from "@/i18n/locales/zh-Hans";
import zhHant from "@/i18n/locales/zh-Hant";

const RESTORE_KEYS = [
  "restoreSource",
  "confirmRestore",
  "cancelRestore",
  "confirmRestoreMessage",
  "restoreFailed",
  "restoreSuccess",
  "restoreUnavailable",
] as const;

describe("Knowledge source restore mobile UI boundary", () => {
  it("keeps archived ingest layout mobile-safe with restore action", () => {
    const ingest = readFileSync(
      join(process.cwd(), "src/components/knowledge/knowledge-ingest-client.tsx"),
      "utf8",
    );
    const restoreButton = readFileSync(
      join(
        process.cwd(),
        "src/components/knowledge/knowledge-source-restore-button.tsx",
      ),
      "utf8",
    );
    assert.match(ingest, /overflow-x-auto/);
    assert.match(ingest, /flex flex-wrap/);
    assert.match(ingest, /min-w-0/);
    assert.match(ingest, /KnowledgeSourceRestoreButton/);
    assert.match(ingest, /knowledge\.ingest\.restoreSuccess/);
    assert.match(restoreButton, /variant="secondary"/);
    assert.match(restoreButton, /flex flex-wrap gap-2/);
    assert.match(restoreButton, /knowledge\.ingest\.restoreSource/);
    assert.match(restoreButton, /knowledge\.ingest\.confirmRestoreMessage/);
    assert.doesNotMatch(restoreButton, /variant="danger"/);
  });

  it("defines restore labels in en / zh-Hans / zh-Hant", () => {
    for (const key of RESTORE_KEYS) {
      assert.ok(en.knowledge.ingest[key], `en missing knowledge.ingest.${key}`);
      assert.ok(
        zhHans.knowledge.ingest[key],
        `zh-Hans missing knowledge.ingest.${key}`,
      );
      assert.ok(
        zhHant.knowledge.ingest[key],
        `zh-Hant missing knowledge.ingest.${key}`,
      );
    }
    assert.match(zhHans.knowledge.ingest.restoreSource, /恢复来源/);
    assert.match(zhHant.knowledge.ingest.restoreSource, /恢復來源/);
    assert.match(en.knowledge.ingest.restoreSource, /Restore source/i);
  });

  it("maps restore error codes to localized messages", () => {
    assert.ok(en.knowledge.errors.sourceNotArchived);
    assert.ok(en.knowledge.errors.sourceRestoreConflict);
    assert.ok(zhHans.knowledge.errors.sourceNotArchived);
    assert.ok(zhHant.knowledge.errors.sourceNotArchived);
  });
});
