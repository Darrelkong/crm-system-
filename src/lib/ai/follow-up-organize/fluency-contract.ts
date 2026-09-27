/** Shared, dependency-free contract; never retrieves CRM context. */
export const BASIC_FLUENCY_VERSION = "basic-fluency-v1";
export const BASIC_FLUENCY_MAX_INPUT = 2000;
export const BASIC_FLUENCY_MAX_OUTPUT = 3000;
export type BasicFluencyLocale = "en" | "zh-Hans" | "zh-Hant";
export type BasicFluencyRequest = {
  task: "basic_text_organize";
  schemaVersion: typeof BASIC_FLUENCY_VERSION;
  locale: BasicFluencyLocale;
  text: string;
};
export function basicFluencyLocale(value: unknown): BasicFluencyLocale {
  return value === "en" || value === "zh-Hant" ? value : "zh-Hans";
}
export function parseBasicFluencyRequest(value: unknown): BasicFluencyRequest | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const r = value as Record<string, unknown>;
  if (Object.keys(r).some(k => !["task", "schemaVersion", "locale", "text"].includes(k)) ||
      r.task !== "basic_text_organize" || r.schemaVersion !== BASIC_FLUENCY_VERSION ||
      !["en", "zh-Hans", "zh-Hant"].includes(String(r.locale)) ||
      typeof r.text !== "string" || r.text.trim().length < 5 || r.text.length > BASIC_FLUENCY_MAX_INPUT) return null;
  return { task: r.task, schemaVersion: BASIC_FLUENCY_VERSION, locale: basicFluencyLocale(r.locale), text: r.text };
}

// Preserve exact token sequences, including additions and duplicates. Conservative
// false negatives are preferable to accepting altered contact/financial facts.
const TOKEN_PATTERNS = [
  /https?:\/\/[^\s<>"，。；！？、）]+/giu,
  /[\w.+%-]+@[\w.-]+\.[a-z]{2,}/giu,
  /\+?\d[\d ()-]{6,}\d/g,
  /\d{1,4}[-/.年]\d{1,2}(?:[-/.月]\d{1,4}日?)?(?:[ T]\d{1,2}:\d{2}(?::\d{2})?)?/g,
  /(?:USD|HKD|CNY|RMB|EUR|GBP|US\$|HK\$|[$€£¥￥])\s*\d[\d,.]*(?:\s*(?:万|萬|千|million|thousand))?/gi,
  /\d[\d,.]*\s*(?:%|％|元|万元|萬元|美元|港元|港币|港幣|人民币|人民幣|million|thousand)/gi,
  /[+-]?\d+(?:[.,]\d+)*/g,
  /[零〇一二三四五六七八九十百千万萬亿億两兩]+(?:年|月|日|天|元|成|個|个)/g,
  /(?:考虑|考慮|暂时|暫時|有点|有點|再看看|已决定|已決定|承诺|承諾|一定会|一定會|可能|也许|也許|或许|或許|大概|预计|預計|暂定|暫定|不确定|不確定|尚未|未定|如果|除非|前提|下周|下週|明天|昨天|不想|不愿|不願|不能|没有|沒有|\b(?:may|might|maybe|possibly|perhaps|approximately|if|unless|not|never|no|tomorrow|yesterday)\b)/gi,
];
function tokens(text: string, pattern: RegExp): string[] {
  return (text.match(pattern) ?? []).map(x => x.replace(/[.,;!?]+$/, ""));
}
export function preservesBasicFluencyFacts(input: string, output: string): boolean {
  if (output.length < input.trim().length * 0.65 || output.length > input.length * 2 + 80) return false;
  if (TOKEN_PATTERNS.some(p => JSON.stringify(tokens(input, p)) !== JSON.stringify(tokens(output, p)))) return false;
  // Catch obvious whole-script translation without converting the user's text.
  const hans = /[这说开账户资料齐会预计联络进]/g;
  const hant = /[這說開賬戶資料齊會預計聯絡進]/g;
  const simplified = (input.match(hans) ?? []).filter(c => !/[料]/.test(c)).length;
  const traditional = (input.match(hant) ?? []).filter(c => !/[料]/.test(c)).length;
  if (simplified > 0 && traditional === 0 && (output.match(hant) ?? []).some(c => c !== "料")) return false;
  if (traditional > 0 && simplified === 0 && (output.match(hans) ?? []).some(c => c !== "料")) return false;
  if (!/[\p{Script=Han}]/u.test(input) && /[\p{Script=Han}]/u.test(output)) return false;
  return true;
}
export function parseBasicFluencyOutput(value: unknown, original: string): { text: string } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const r = value as Record<string, unknown>;
  if (Object.keys(r).length !== 1 || typeof r.text !== "string") return null;
  const text = r.text.trim();
  if (!text || text.length > BASIC_FLUENCY_MAX_OUTPUT || /<\/?think\b|```/i.test(text)) return null;
  return preservesBasicFluencyFacts(original, text) ? { text } : null;
}
