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
    for (const [key, child] of Object.entries(
      value as Record<string, unknown>,
    )) {
      const next = prefix ? `${prefix}.${key}` : key;
      collectStringKeys(child, next, out);
    }
  }
  return out;
}

describe("Phase 4C i18n key parity", () => {
  it("keeps followUpOrganize keys aligned across locales", () => {
    const enKeys = collectStringKeys(
      en.followUpOrganize,
      "followUpOrganize",
    ).sort();
    const hantKeys = collectStringKeys(
      zhHant.followUpOrganize,
      "followUpOrganize",
    ).sort();
    const hansKeys = collectStringKeys(
      zhHans.followUpOrganize,
      "followUpOrganize",
    ).sort();
    assert.deepEqual(hantKeys, enKeys);
    assert.deepEqual(hansKeys, enKeys);
  });
});
