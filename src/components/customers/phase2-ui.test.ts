import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";
import en from "@/i18n/locales/en";
import zhHant from "@/i18n/locales/zh-Hant";
import zhHans from "@/i18n/locales/zh-Hans";
import {
  isPhase2SafeSuggestedMessagePlaceholder,
  isSafeSuggestedMessageAvailable,
  PHASE2_SAFE_SUGGESTED_MESSAGE_PLACEHOLDER,
} from "@/lib/ai/customer-insights/safe-suggested-message";

const root = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

function readSrc(rel: string): string {
  return readFileSync(path.join(root, rel), "utf8");
}

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

describe("Phase 5C-2 Customer AI Insight UI", () => {
  it("keeps customers.phase2 i18n key parity across locales", () => {
    const enKeys = collectStringKeys(
      (en.customers as Record<string, unknown>).phase2,
      "customers.phase2",
    ).sort();
    const hantKeys = collectStringKeys(
      (zhHant.customers as Record<string, unknown>).phase2,
      "customers.phase2",
    ).sort();
    const hansKeys = collectStringKeys(
      (zhHans.customers as Record<string, unknown>).phase2,
      "customers.phase2",
    ).sort();
    assert.deepEqual(hantKeys, enKeys);
    assert.deepEqual(hansKeys, enKeys);
    assert.ok(enKeys.includes("customers.phase2.weight"));
    assert.ok(enKeys.includes("customers.phase2.sourceType.generic"));
  });

  it("avoids probability / guaranteed-loss wording in phase2 copy", () => {
    for (const locale of [en, zhHant, zhHans]) {
      const phase2 = (locale.customers as { phase2: Record<string, unknown> })
        .phase2;
      const blob = JSON.stringify(phase2);
      assert.equal(
        /成交概率|成功率|一定会流失|customer certainly lost/i.test(blob),
        false,
      );
      assert.match(
        String(phase2.opportunityTitle),
        /Opportunity|成交机会|成交機會/,
      );
      assert.match(
        String(phase2.churnTitle),
        /progress risk|推进风险|推進風險/i,
      );
      assert.match(String(phase2.painPointsTitle), /Potential|可能/);
    }
  });

  it("detects safe suggested-message placeholder by exact shared constant", () => {
    assert.equal(
      isPhase2SafeSuggestedMessagePlaceholder(
        PHASE2_SAFE_SUGGESTED_MESSAGE_PLACEHOLDER,
      ),
      true,
    );
    assert.equal(
      isSafeSuggestedMessageAvailable("您好，想确认一下资料准备情况。"),
      true,
    );
    assert.equal(isSafeSuggestedMessageAvailable("建议跟进内容"), true);
    assert.equal(
      isSafeSuggestedMessageAvailable(PHASE2_SAFE_SUGGESTED_MESSAGE_PLACEHOLDER),
      false,
    );
  });

  it("panel wires Phase2 sections and suggested message without extra fetch", () => {
    const panel = readSrc(
      "src/components/customers/customer-ai-insight-panel.tsx",
    );
    assert.match(panel, /AiInsightPhase2Sections/);
    assert.match(panel, /AiInsightSuggestedMessage/);
    assert.match(panel, /phase2Generated/);
    assert.match(panel, /advancedUnavailable/);
    assert.equal(panel.includes("dangerouslySetInnerHTML"), false);
    assert.equal(/ai-insight\/phase2/.test(panel), false);
    assert.equal((panel.match(/fetch\(/g) ?? []).length, 2);
  });

  it("phase2 sections hide empty factors/pain and do not render sourceId", () => {
    const sections = readSrc(
      "src/components/customers/ai-insight-phase2-sections.tsx",
    );
    assert.match(sections, /positiveFactors\.length > 0/);
    assert.match(sections, /negativeFactors\.length > 0/);
    assert.match(sections, /painPoints\.length > 0/);
    assert.match(sections, /aria-expanded/);
    assert.match(sections, /whitespace-pre-wrap/);
    assert.match(sections, /resolveOpportunityScoreDisplay/);
    assert.match(sections, /formatHongKongDate/);
    assert.match(sections, /min-w-0/);
    assert.equal(sections.includes("sourceId"), false);
    assert.equal(sections.includes("dangerouslySetInnerHTML"), false);
    assert.equal(sections.includes("<table"), false);
    assert.equal(/timeWindow/.test(sections), false);
  });

  it("suggested message supports local edit/copy and hides unavailable draft", () => {
    const message = readSrc(
      "src/components/customers/ai-insight-suggested-message.tsx",
    );
    assert.match(message, /isSafeSuggestedMessageAvailable/);
    assert.match(message, /safeMessageUnavailable/);
    assert.match(message, /copyTextToClipboard/);
    assert.match(message, /restoreSuggestion/);
    assert.match(message, /aria-live/);
    assert.match(message, /aria-labelledby/);
    assert.match(message, /buildSuggestedMessageResetKey/);
    assert.match(message, /disabled=\{!canCopy\}/);
    assert.equal(
      message.includes("（建议文案未通过合规校验，请自行撰写跟进内容。）"),
      false,
    );
    const start = message.indexOf("if (!available)");
    const firstReturn = message.indexOf("return (", start);
    const secondReturn = message.indexOf("return (", firstReturn + 1);
    assert.ok(start >= 0 && firstReturn >= 0 && secondReturn > firstReturn);
    const unavailableBlock = message.slice(start, secondReturn);
    assert.equal(unavailableBlock.includes("copyMessage"), false);
    assert.equal(unavailableBlock.includes("restoreSuggestion"), false);
    assert.equal(unavailableBlock.includes("<textarea"), false);
    assert.match(unavailableBlock, /safeMessageUnavailable/);
  });

  it("shared placeholder module stays client-safe and is used by compose", () => {
    const shared = readSrc(
      "src/lib/ai/customer-insights/safe-suggested-message.ts",
    );
    const compose = readSrc("src/lib/ai/customer-insights/phase2-compose.ts");
    assert.equal(shared.includes("validateSuggestedEmployeeMessage"), false);
    assert.equal(shared.includes("from \"react\""), false);
    assert.equal(shared.includes("drizzle"), false);
    assert.match(compose, /safe-suggested-message/);
    assert.match(compose, /sanitizeSuggestedEmployeeMessageForPersist/);
    assert.equal(
      compose.includes("（建议文案未通过合规校验，请自行撰写跟进内容。）"),
      false,
    );
  });
});
