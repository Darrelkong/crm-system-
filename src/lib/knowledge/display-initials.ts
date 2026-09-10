/**
 * Deterministic initials for Knowledge member rows (presentation only).
 */
export function knowledgeDisplayInitials(displayName: string): string {
  const trimmed = displayName.trim();
  if (!trimmed) return "?";

  const dotted = trimmed.split(/[.\s]+/).filter(Boolean);
  if (dotted.length >= 2) {
    const first = dotted[0]?.[0] ?? "";
    const last = dotted[dotted.length - 1]?.[0] ?? "";
    return `${first}${last}`.toUpperCase();
  }

  const token = dotted[0] ?? trimmed;
  const camelParts = token.split(/(?=[A-Z])/).filter(Boolean);
  if (camelParts.length >= 2) {
    const first = camelParts[0]?.[0] ?? "";
    const last = camelParts[camelParts.length - 1]?.[0] ?? "";
    return `${first}${last}`.toUpperCase();
  }

  if (token.length >= 2) {
    return token.slice(0, 2).toUpperCase();
  }

  return token[0]?.toUpperCase() ?? "?";
}
