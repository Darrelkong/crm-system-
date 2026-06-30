/** Staff public pool list: 張三三 → 張**, Daniel Smith → D** */
export function maskPublicPoolCustomerName(value?: string | null): string {
  const trimmed = value?.trim();
  if (!trimmed) return "";

  const chars = [...trimmed];
  const first = chars[0];

  if (/[\u4e00-\u9fff]/.test(first)) {
    return `${first}**`;
  }

  const letter = trimmed.match(/[A-Za-z]/)?.[0];
  if (letter) {
    return `${letter.toUpperCase()}**`;
  }

  return `${first}**`;
}

/** Pool reason preview: first 3 chars + ⋯ when longer than 3. */
export function truncatePoolReason(reason: string | null | undefined): string | null {
  const trimmed = reason?.trim();
  if (!trimmed) return null;

  const chars = [...trimmed];
  if (chars.length <= 3) return trimmed;

  return `${chars.slice(0, 3).join("")}⋯`;
}
