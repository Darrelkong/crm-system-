import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import en from "@/i18n/locales/en";
import zhHans from "@/i18n/locales/zh-Hans";
import zhHant from "@/i18n/locales/zh-Hant";

const localeFiles = [
  { locale: "en", source: en, jsonPath: "public/locales/en.json" },
  { locale: "zh-Hans", source: zhHans, jsonPath: "public/locales/zh-Hans.json" },
  { locale: "zh-Hant", source: zhHant, jsonPath: "public/locales/zh-Hant.json" },
] as const;

describe("locale catalog JSON parity", () => {
  for (const { locale, source, jsonPath } of localeFiles) {
    it(`keeps ${locale}.ts and ${jsonPath} in sync`, () => {
      const json = JSON.parse(readFileSync(jsonPath, "utf8"));
      assert.deepEqual(json, source);
    });
  }
});
