export type RecipientChipData = {
  id: string;
  email: string;
  displayName?: string;
};

export const MAX_RECIPIENTS_PER_MESSAGE = 50;

export type RecipientLists = {
  to: RecipientChipData[];
  cc: RecipientChipData[];
  bcc: RecipientChipData[];
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
  const normalized = normalizeEmail(email);
  if (!normalized || normalized.length > 254) return false;
  return EMAIL_PATTERN.test(normalized);
}

/** Split pasted or typed input into candidate addresses. */
export function parseRecipientTokens(text: string): string[] {
  return text
    .split(/[,;\n]+|\s+(?=[^\s@]+@)/)
    .map((part) => part.trim())
    .filter(Boolean);
}

export function chipsToEmails(chips: RecipientChipData[]): string[] {
  return chips.map((chip) => chip.email);
}

export function emailsToChips(
  emails: string[],
  lookup?: (email: string) => Partial<RecipientChipData> | null,
): RecipientChipData[] {
  return emails.map((raw) => {
    const email = normalizeEmail(raw);
    const meta = lookup?.(email);
    return {
      id: crypto.randomUUID(),
      email,
      displayName: meta?.displayName,
    };
  });
}

export function countUniqueRecipients(lists: RecipientLists): number {
  const seen = new Set<string>();
  for (const chips of [lists.to, lists.cc, lists.bcc]) {
    for (const chip of chips) {
      seen.add(normalizeEmail(chip.email));
    }
  }
  return seen.size;
}

export function remainingRecipientCapacity(lists: RecipientLists): number {
  return MAX_RECIPIENTS_PER_MESSAGE - countUniqueRecipients(lists);
}

export function isRecipientLimitReached(lists: RecipientLists): boolean {
  return countUniqueRecipients(lists) >= MAX_RECIPIENTS_PER_MESSAGE;
}

export function emailExistsInLists(
  email: string,
  lists: RecipientLists,
): boolean {
  const normalized = normalizeEmail(email);
  return [lists.to, lists.cc, lists.bcc].some((chips) =>
    chips.some((chip) => normalizeEmail(chip.email) === normalized),
  );
}

export function findDuplicateField(
  email: string,
  field: "to" | "cc" | "bcc",
  lists: RecipientLists,
): "to" | "cc" | "bcc" | null {
  const normalized = normalizeEmail(email);
  const fields: Array<["to" | "cc" | "bcc", RecipientChipData[]]> = [
    ["to", lists.to],
    ["cc", lists.cc],
    ["bcc", lists.bcc],
  ];
  for (const [name, chips] of fields) {
    if (name === field) continue;
    if (chips.some((chip) => normalizeEmail(chip.email) === normalized)) {
      return name;
    }
  }
  if (lists[field].some((chip) => normalizeEmail(chip.email) === normalized)) {
    return field;
  }
  return null;
}

export function initChipsFromDraft(
  value: string | string[] | undefined,
  lookup?: (email: string) => Partial<RecipientChipData> | null,
): RecipientChipData[] {
  if (!value) return [];
  const emails = Array.isArray(value) ? value : parseRecipientTokens(value);
  return emailsToChips(emails.filter(isValidEmail), lookup);
}

export function recipientListsToApiPayload(lists: RecipientLists): Array<{
  recipientType: "to" | "cc" | "bcc";
  address: string;
  displayName?: string;
  sortOrder: number;
}> {
  const payload: Array<{
    recipientType: "to" | "cc" | "bcc";
    address: string;
    displayName?: string;
    sortOrder: number;
  }> = [];
  let sortOrder = 0;
  for (const recipientType of ["to", "cc", "bcc"] as const) {
    for (const chip of lists[recipientType]) {
      payload.push({
        recipientType,
        address: chip.email,
        ...(chip.displayName ? { displayName: chip.displayName } : {}),
        sortOrder: sortOrder++,
      });
    }
  }
  return payload;
}

export function recipientViewsToLists(
  recipients: Array<{
    recipientType: "to" | "cc" | "bcc";
    address: string;
    displayName: string | null;
  }>,
): RecipientLists {
  const lists: RecipientLists = { to: [], cc: [], bcc: [] };
  for (const recipient of recipients) {
    lists[recipient.recipientType].push({
      id: crypto.randomUUID(),
      email: recipient.address,
      displayName: recipient.displayName ?? undefined,
    });
  }
  return lists;
}
