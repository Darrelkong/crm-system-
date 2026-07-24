import {
  FOLLOW_UP_ORGANIZE_MAX_LENGTH,
  FOLLOW_UP_ORGANIZE_MIN_LENGTH,
  FOLLOW_UP_ORGANIZE_SOURCE_BASIC,
  emptyExtracted,
  type FollowUpOrganizationResult,
  type FollowUpOrganizeWarning,
} from "@/lib/ai/follow-up-organize/types";

const MULTI_SPACE = /[^\S\n]{2,}/g;
const MULTI_NEWLINE = /\n{3,}/g;
const SAFE_PUNCT = /([。！？!?；;，,])\1+/g;
const AMBIGUOUS_DATE =
  /(下週|下周|過幾天|过几天|有空再|晚點|晚点|月底左右|改天|之後再說|之后再说)/;
const NEXT_ACTION_HINT =
  /(下一步|下次|跟進|跟进|回電|回电|發送|发送|約見|约见|準備|准备|提交)/;
const PHONE_LIKE = /(?:\+?\d[\d\s\-()]{6,}\d)/g;
const EMAIL_LIKE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const URL_LIKE = /https?:\/\/[^\s]+/gi;

export type OrganizeFollowUpBasicOptions = {
  nowIso?: string;
};

function protectTokens(text: string): {
  text: string;
  restore: (value: string) => string;
} {
  const tokens: string[] = [];
  const push = (match: string) => {
    const idx = tokens.length;
    tokens.push(match);
    return `__ORG_TOKEN_${idx}__`;
  };

  let protectedText = text;
  protectedText = protectedText.replace(URL_LIKE, (m) => push(m));
  protectedText = protectedText.replace(EMAIL_LIKE, (m) => push(m));
  protectedText = protectedText.replace(PHONE_LIKE, (m) => push(m));

  return {
    text: protectedText,
    restore: (value: string) =>
      value.replace(/__ORG_TOKEN_(\d+)__/g, (_, n: string) => tokens[Number(n)] ?? ""),
  };
}

function detectExplicitDate(
  text: string,
): FollowUpOrganizationResult["extracted"]["agreedFollowUpAt"] {
  // Avoid String.match with /g (drops capture groups).
  const iso = /\b(\d{4}-\d{2}-\d{2})(?:[T\s]\d{2}:\d{2}(?::\d{2})?)?\b/.exec(
    text,
  );
  if (iso?.[1]) {
    return { rawText: iso[0], isoCandidate: iso[1] };
  }
  const cn = /(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/.exec(text);
  if (cn) {
    const y = cn[1];
    const m = cn[2].padStart(2, "0");
    const d = cn[3].padStart(2, "0");
    return { rawText: cn[0], isoCandidate: `${y}-${m}-${d}` };
  }
  const time = /\b([01]?\d|2[0-3]):([0-5]\d)\b/.exec(text);
  if (time?.[0]) {
    return { rawText: time[0], isoCandidate: null };
  }
  return null;
}

/**
 * Deterministic, network-free follow-up text cleanup.
 * Does not invent facts or rewrite meaning.
 */
export function organizeFollowUpTextBasic(
  rawText: string,
  options: OrganizeFollowUpBasicOptions = {},
): FollowUpOrganizationResult {
  const originalText = typeof rawText === "string" ? rawText : "";
  const generatedAt = options.nowIso ?? new Date().toISOString();
  const warnings: FollowUpOrganizeWarning[] = [];

  if (!originalText.trim()) {
    return {
      source: FOLLOW_UP_ORGANIZE_SOURCE_BASIC,
      originalText,
      organizedText: "",
      extracted: emptyExtracted(),
      warnings: [
        {
          code: "INPUT_EMPTY",
          messageKey: "followUpOrganize.warnings.inputEmpty",
        },
      ],
      generatedAt,
    };
  }

  if (originalText.length > FOLLOW_UP_ORGANIZE_MAX_LENGTH) {
    return {
      source: FOLLOW_UP_ORGANIZE_SOURCE_BASIC,
      originalText,
      organizedText: originalText,
      extracted: emptyExtracted(),
      warnings: [
        {
          code: "INPUT_TOO_LONG",
          messageKey: "followUpOrganize.warnings.inputTooLong",
        },
      ],
      generatedAt,
    };
  }

  const { text: protectedText, restore } = protectTokens(originalText);
  let organized = protectedText.replace(/\r\n/g, "\n").trim();
  organized = organized.replace(MULTI_SPACE, " ");
  organized = organized.replace(MULTI_NEWLINE, "\n\n");
  organized = organized.replace(SAFE_PUNCT, "$1");
  organized = restore(organized).trim();

  const extracted = emptyExtracted();
  const explicitDate = detectExplicitDate(originalText);
  if (explicitDate) {
    extracted.agreedFollowUpAt = explicitDate;
  } else if (AMBIGUOUS_DATE.test(originalText)) {
    warnings.push({
      code: "AMBIGUOUS_DATE",
      messageKey: "followUpOrganize.warnings.ambiguousDate",
    });
  }

  if (originalText.trim().length < FOLLOW_UP_ORGANIZE_MIN_LENGTH) {
    warnings.push({
      code: "TEXT_TOO_SHORT",
      messageKey: "followUpOrganize.warnings.textTooShort",
    });
  }

  if (!NEXT_ACTION_HINT.test(originalText)) {
    warnings.push({
      code: "NEXT_ACTION_MISSING",
      messageKey: "followUpOrganize.warnings.nextActionMissing",
    });
  }

  return {
    source: FOLLOW_UP_ORGANIZE_SOURCE_BASIC,
    originalText,
    organizedText: organized,
    extracted,
    warnings,
    generatedAt,
  };
}
