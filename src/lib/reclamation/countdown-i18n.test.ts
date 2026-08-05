import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import en from "@/i18n/locales/en";
import zhHans from "@/i18n/locales/zh-Hans";
import zhHant from "@/i18n/locales/zh-Hant";

const COUNTDOWN_KEYS = [
  "reclaimCountdownDays",
  "reclaimCountdownTomorrow",
  "reclaimCountdownDue",
  "reclaimCountdownGrace",
  "reclaimCountdownGraceHours",
  "reclaimCountdownTooltipLastValid",
  "reclaimCountdownTooltipExpected",
  "reclaimCountdownTooltipRule",
  "reclaimCountdownTooltipGrace",
] as const;

describe("reclamation countdown i18n", () => {
  it("defines countdown keys in zh-Hans, zh-Hant, and en", () => {
    for (const key of COUNTDOWN_KEYS) {
      assert.equal(typeof zhHans.customers[key], "string");
      assert.equal(typeof zhHant.customers[key], "string");
      assert.equal(typeof en.customers[key], "string");
      assert.ok(String(zhHans.customers[key]).length > 0);
      assert.ok(String(zhHant.customers[key]).length > 0);
      assert.ok(String(en.customers[key]).length > 0);
    }
  });

  it("uses auto-release wording instead of abandonment wording", () => {
    const samples = [
      zhHans.customers.reclaimCountdownDays,
      zhHans.customers.reclaimCountdownTomorrow,
      zhHans.customers.reclaimCountdownDue,
      zhHant.customers.reclaimCountdownDays,
      en.customers.reclaimCountdownDays,
      en.customers.reclaimCountdownTomorrow,
    ];
    for (const sample of samples) {
      assert.doesNotMatch(String(sample), /放弃|放棄|abandon/i);
    }
  });

  it("badge component has no hardcoded Chinese/English countdown copy", () => {
    const source = readFileSync(
      "src/components/customers/reclamation-countdown-badge.tsx",
      "utf8",
    );
    assert.doesNotMatch(source, /距自动释放|明日自动释放|Auto-release in/);
    assert.match(source, /customers\.reclaimCountdown/);
  });
});
