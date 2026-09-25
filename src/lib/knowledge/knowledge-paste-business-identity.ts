import {
  getRequestedProjectGroup,
  getRequestedProjectItem,
  type RequestedProjectGroupCode,
} from "@/lib/constants/requested-projects";
import type { KnowledgeAiOrganizationOutput } from "@/lib/knowledge/ai-organizer-schema";

export type KnowledgePasteCategoryMatch =
  | "confident"
  | "needs_confirmation"
  | "no_match";

export type KnowledgePasteBusinessIdentity = {
  title: string;
  countryGroupCode: RequestedProjectGroupCode;
  countryLabelZhHans: string;
  requestedProjectCode: string | null;
  categoryMatch: KnowledgePasteCategoryMatch;
  signal: "chase_us_banking" | "hsbc_hk_banking" | "hk_private_banking" | "unknown";
  confidence: number;
};

export type KnowledgePasteBusinessIdentityJson = KnowledgePasteBusinessIdentity & {
  identityConsistent: boolean;
};

const CONFIDENT_SCORE = 4;

function normalizeForMatch(value: string): string {
  return value
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[，,。．.；;：:、]/g, "");
}

function firstMeaningfulLine(text: string): string {
  return (
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? ""
  );
}

function scoreChaseUsBanking(text: string): number {
  let score = 0;
  if (/chase\s+private\s+client/i.test(text)) score += 5;
  if (/大通私人银行/.test(text)) score += 4;
  if (/\bzelle\b/i.test(text)) score += 3;
  if (/\bach\b/i.test(text) && /(美元|美金|美国)/.test(text)) score += 2;
  if (/美国地址/.test(text)) score += 2;
  if (/15\s*w|15w/i.test(text)) score += 1;
  if (/在线电汇/.test(text) && /万美元/.test(text)) score += 1;
  return score;
}

function scoreHsbcHkBanking(text: string): number {
  let score = 0;
  if (/香港汇丰|汇丰银行|汇丰香港|汇丰银行账户/.test(text)) score += 5;
  if (/\bhsbc\b/i.test(text)) score += 3;
  if (/滙豐/.test(text)) score += 3;
  if (/香港.*银行/.test(text) && /汇丰|滙豐/.test(text)) score += 2;
  return score;
}

function scoreHkPrivateBanking(text: string): number {
  let score = 0;
  if (/中国银行.*香港|中國銀行.*香港/.test(text)) score += 5;
  if (/香港私人银行|香港私人銀行/.test(text) && !/汇丰|滙豐|\bhsbc\b/i.test(text)) {
    score += 4;
  }
  if (/中银香港|中銀香港/.test(text)) score += 4;
  return score;
}

type IdentityCandidate = KnowledgePasteBusinessIdentity & { score: number };

function buildCandidate(
  signal: IdentityCandidate["signal"],
  score: number,
  title: string,
  groupCode: RequestedProjectGroupCode,
  requestedProjectCode: string,
): IdentityCandidate {
  const group = getRequestedProjectGroup(groupCode)!;
  return {
    signal,
    score,
    title,
    countryGroupCode: groupCode,
    countryLabelZhHans: group.labels["zh-Hans"],
    requestedProjectCode,
    categoryMatch:
      score >= CONFIDENT_SCORE ? "confident" : "needs_confirmation",
    confidence: score,
  };
}

export function deriveKnowledgePasteBusinessIdentity(
  rawText: string,
): KnowledgePasteBusinessIdentity {
  const text = rawText.trim();
  const chaseScore = scoreChaseUsBanking(text);
  const hsbcScore = scoreHsbcHkBanking(text);
  const hkPrivateScore = scoreHkPrivateBanking(text);

  const candidates: IdentityCandidate[] = [];
  if (chaseScore > 0) {
    const line = firstMeaningfulLine(text);
    const title =
      /chase\s+private\s+client/i.test(line) || /大通私人银行/.test(line)
        ? line.replace(/^#+\s*/, "").slice(0, 200)
        : "Chase Private Client";
    candidates.push(
      buildCandidate(
        "chase_us_banking",
        chaseScore,
        title,
        "united_states",
        "us_bank_account",
      ),
    );
  }
  if (hsbcScore > 0) {
    const line = firstMeaningfulLine(text);
    const title =
      /汇丰|滙豐|hsbc/i.test(line)
        ? line.includes("账户") || line.includes("賬戶")
          ? line.replace(/^#+\s*/, "").slice(0, 200)
          : "香港汇丰银行账户"
        : "香港汇丰银行账户";
    candidates.push(
      buildCandidate(
        "hsbc_hk_banking",
        hsbcScore,
        title,
        "hong_kong",
        "hk_bank_account",
      ),
    );
  }
  if (hkPrivateScore > 0) {
    const line = firstMeaningfulLine(text).replace(/^#+\s*/, "").slice(0, 200);
    const title =
      line.length > 0 ? line : "香港私人银行账户";
    candidates.push(
      buildCandidate(
        "hk_private_banking",
        hkPrivateScore,
        title,
        "hong_kong",
        "hk_bank_account",
      ),
    );
  }

  if (candidates.length === 0) {
    return {
      signal: "unknown",
      confidence: 0,
      title: firstMeaningfulLine(text).replace(/^#+\s*/, "").slice(0, 200) || "Knowledge 来源整理草稿",
      countryGroupCode: "other",
      countryLabelZhHans: "其他",
      requestedProjectCode: null,
      categoryMatch: "no_match",
    };
  }

  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0]!;
  const runnerUp = candidates[1];
  const { score: omittedScore, ...identity } = best;
  void omittedScore;
  if (runnerUp && runnerUp.score >= CONFIDENT_SCORE && best.score - runnerUp.score < 2) {
    return {
      ...identity,
      categoryMatch: "needs_confirmation",
      requestedProjectCode: best.requestedProjectCode,
    };
  }
  return identity;
}

const US_BANKING_MARKERS = [
  "chase",
  "zelle",
  "大通私人",
  "美国地址",
  "privateclient",
] as const;

const HK_HSBC_MARKERS = ["汇丰", "滙豐", "hsbc", "香港汇丰"] as const;

function textHasAnyMarker(text: string, markers: readonly string[]): boolean {
  const normalized = normalizeForMatch(text);
  return markers.some((marker) => normalized.includes(normalizeForMatch(marker)));
}

export function assessOrganizerIdentityConsistency(input: {
  evidenceText: string;
  title: string;
  body: string;
  identity: KnowledgePasteBusinessIdentity;
}): { consistent: boolean; conflictingMarkers: string[] } {
  const titleNorm = `${input.title}\n${input.body}`;
  const evidenceIdentity = deriveKnowledgePasteBusinessIdentity(input.evidenceText);

  if (input.identity.signal === "unknown" || evidenceIdentity.signal === "unknown") {
    return { consistent: true, conflictingMarkers: [] };
  }

  if (input.identity.signal !== evidenceIdentity.signal) {
    return {
      consistent: false,
      conflictingMarkers: [input.identity.signal, evidenceIdentity.signal],
    };
  }

  const usInTitle = textHasAnyMarker(titleNorm, US_BANKING_MARKERS);
  const hkInTitle = textHasAnyMarker(titleNorm, HK_HSBC_MARKERS);
  if (input.identity.signal === "chase_us_banking" && hkInTitle && !usInTitle) {
    return { consistent: false, conflictingMarkers: ["hk_hsbc_in_output"] };
  }
  if (input.identity.signal === "hsbc_hk_banking" && usInTitle && !hkInTitle) {
    return { consistent: false, conflictingMarkers: ["us_chase_in_output"] };
  }
  if (input.identity.signal === "chase_us_banking" && hkInTitle && usInTitle) {
    return { consistent: false, conflictingMarkers: ["mixed_banking_markers"] };
  }
  if (input.identity.signal === "hsbc_hk_banking" && usInTitle && hkInTitle) {
    return { consistent: false, conflictingMarkers: ["mixed_banking_markers"] };
  }

  return { consistent: true, conflictingMarkers: [] };
}

function canonicalizeTitleIncludesIdentity(
  organizerTitle: string,
  identityTitle: string,
): boolean {
  const compactOrganizer = organizerTitle.replace(/\s+/g, "");
  const compactIdentity = identityTitle.replace(/\s+/g, "");
  return compactOrganizer.includes(compactIdentity);
}

export function applyBusinessIdentityToOrganizerOutput(
  rawText: string,
  output: KnowledgeAiOrganizationOutput,
): {
  output: KnowledgeAiOrganizationOutput;
  identity: KnowledgePasteBusinessIdentityJson;
} {
  const identity = deriveKnowledgePasteBusinessIdentity(rawText);
  let nextOutput: KnowledgeAiOrganizationOutput = { ...output };

  if (identity.signal !== "unknown") {
    const organizerTitle = nextOutput.title?.trim() ?? "";
    const keepOrganizerTitle =
      organizerTitle.length > identity.title.length + 4 &&
      (organizerTitle.includes(identity.title) ||
        canonicalizeTitleIncludesIdentity(organizerTitle, identity.title));
    nextOutput = {
      ...nextOutput,
      title: keepOrganizerTitle ? organizerTitle : identity.title,
      suggestedCategory:
        identity.requestedProjectCode
          ? getRequestedProjectItem(identity.requestedProjectCode)?.canonicalZhHans ??
            nextOutput.suggestedCategory
          : nextOutput.suggestedCategory,
    };
  }

  const consistency = assessOrganizerIdentityConsistency({
    evidenceText: rawText,
    title: nextOutput.title,
    body: nextOutput.body,
    identity,
  });

  const warnings = [...nextOutput.warnings];
  if (!consistency.consistent) {
    warnings.unshift("标题与正文业务身份不一致，需要人工确认");
  }
  if (identity.categoryMatch === "needs_confirmation") {
    warnings.unshift("需要确认分类");
  }
  if (identity.categoryMatch === "no_match") {
    warnings.unshift("未找到合适的现有分类");
  }

  return {
    output: { ...nextOutput, warnings },
    identity: {
      ...identity,
      identityConsistent: consistency.consistent,
    },
  };
}

export function parseKnowledgePasteBusinessIdentityJson(
  value: string | null | undefined,
): KnowledgePasteBusinessIdentityJson | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as KnowledgePasteBusinessIdentityJson;
    if (!parsed || typeof parsed !== "object") return null;
    if (typeof parsed.title !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function serializeKnowledgePasteBusinessIdentityJson(
  identity: KnowledgePasteBusinessIdentityJson,
): string {
  return JSON.stringify(identity);
}
