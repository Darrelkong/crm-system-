import assert from "node:assert/strict";
import { describe, it } from "node:test";
import en from "@/i18n/locales/en";
import zhHant from "@/i18n/locales/zh-Hant";
import zhHans from "@/i18n/locales/zh-Hans";

function collectStringKeys(
  value: unknown,
  prefix = "",
  out: string[] = [],
): string[] {
  if (typeof value === "string") {
    out.push(prefix);
    return out;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const next = prefix ? `${prefix}.${key}` : key;
      collectStringKeys(child, next, out);
    }
  }
  return out;
}

describe("Phase 4B i18n key parity", () => {
  it("keeps basicAnalysis and deepAnalysis keys aligned across locales", () => {
    const sections = ["basicAnalysis", "deepAnalysis", "analysisPanel"] as const;
    for (const section of sections) {
      const enKeys = collectStringKeys(
        (en.customers as Record<string, unknown>)[section],
        `customers.${section}`,
      ).sort();
      const hantKeys = collectStringKeys(
        (zhHant.customers as Record<string, unknown>)[section],
        `customers.${section}`,
      ).sort();
      const hansKeys = collectStringKeys(
        (zhHans.customers as Record<string, unknown>)[section],
        `customers.${section}`,
      ).sort();
      assert.deepEqual(hantKeys, enKeys);
      assert.deepEqual(hansKeys, enKeys);
    }
  });

  it("does not label basic analysis as AI analysis", () => {
    assert.equal(en.customers.basicAnalysis.title.includes("AI"), false);
    assert.equal(zhHant.customers.basicAnalysis.title.includes("AI"), false);
    assert.equal(zhHans.customers.basicAnalysis.title.includes("AI"), false);
    assert.match(en.customers.basicAnalysis.title, /Basic system analysis/i);
  });
});
