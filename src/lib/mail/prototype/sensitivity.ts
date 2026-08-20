import type { MailPrototypeScenario } from "./types";

const SENSITIVE_FILENAME_PATTERNS = [
  "passport",
  "bank",
  "statement",
  "id",
  "contract",
];

export function detectSensitiveAttachmentHint(
  filenames: string[],
): boolean {
  return filenames.some((name) => {
    const lower = name.toLowerCase();
    return SENSITIVE_FILENAME_PATTERNS.some((p) => lower.includes(p));
  });
}

export function canSelectRestrictedSensitivity(
  scenario: MailPrototypeScenario,
): boolean {
  return scenario === "admin";
}
