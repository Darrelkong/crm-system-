const TAG_KEY_MAX_LENGTH = 64;

export function slugifyTagKey(label: string): string {
  const normalized = label
    .trim()
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fff]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, TAG_KEY_MAX_LENGTH);

  return normalized || `tag_${crypto.randomUUID().slice(0, 8)}`;
}

export function ensureUniqueTagKey(
  baseKey: string,
  existingKeys: ReadonlySet<string>,
): string {
  if (!existingKeys.has(baseKey)) {
    return baseKey;
  }

  let suffix = 2;
  let candidate = `${baseKey}_${suffix}`;
  while (existingKeys.has(candidate)) {
    suffix += 1;
    candidate = `${baseKey}_${suffix}`.slice(0, TAG_KEY_MAX_LENGTH);
  }
  return candidate;
}

export function validateTagLabel(label: string): string | null {
  const trimmed = label.trim();
  if (!trimmed) {
    return "CUSTOMER_TAG_LABEL_REQUIRED";
  }
  if (trimmed.length < 2) {
    return "CUSTOMER_TAG_LABEL_TOO_SHORT";
  }
  return null;
}
