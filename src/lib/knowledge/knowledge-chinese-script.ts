import * as OpenCC from "opencc-js";
import { normalizeKnowledgeSourceText } from "@/lib/knowledge/source-text-normalization";

const TRADITIONAL_TO_SIMPLIFIED = OpenCC.Converter({ from: "tw", to: "cn" });
const HONG_KONG_TO_SIMPLIFIED = OpenCC.Converter({ from: "hk", to: "cn" });

/** Deterministic Simplified Chinese form for fact comparison (not for mutating source evidence). */
export function toSimplifiedChineseForComparison(text: string): string {
  return HONG_KONG_TO_SIMPLIFIED(TRADITIONAL_TO_SIMPLIFIED(text));
}

export function normalizeForKnowledgeFactComparison(value: string): string {
  const normalized = normalizeKnowledgeSourceText(value).normalize("NFKC");
  const simplified = toSimplifiedChineseForComparison(normalized);
  return simplified.replace(/\s+/g, "").toLowerCase();
}
