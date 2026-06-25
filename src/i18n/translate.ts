import type { Messages } from "./locales/en";

export function translate(
  messages: Messages,
  key: string,
  params?: Record<string, string>,
): string {
  const parts = key.split(".");
  let current: unknown = messages;

  for (const part of parts) {
    if (current && typeof current === "object" && part in current) {
      current = (current as Record<string, unknown>)[part];
    } else {
      return key;
    }
  }

  if (typeof current !== "string") {
    return key;
  }

  if (!params) {
    return current;
  }

  return Object.entries(params).reduce(
    (text, [name, value]) => text.replaceAll(`{{${name}}}`, value),
    current,
  );
}
