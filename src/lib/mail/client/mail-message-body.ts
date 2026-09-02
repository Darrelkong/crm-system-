export type MailMessageBodyMode = "html" | "plain_text" | "empty";

export type MailMessageBodyInput = {
  bodyHtml: string | null | undefined;
  bodyText: string | null | undefined;
};

export type ResolvedMailMessageBody = {
  mode: MailMessageBodyMode;
  content: string;
};

function hasMeaningfulHtml(html: string): boolean {
  return html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&(?:nbsp|#160);/gi, " ")
    .trim()
    .length > 0;
}

/**
 * Resolves server-normalized message content without reparsing or sanitizing
 * in the browser. `bodyHtml` is persisted only after inbound sanitization.
 */
export function resolveMailMessageBody(
  input: MailMessageBodyInput,
): ResolvedMailMessageBody {
  const html = input.bodyHtml?.trim() ?? "";
  if (html && hasMeaningfulHtml(html)) {
    return { mode: "html", content: html };
  }

  const text = input.bodyText?.trim() ?? "";
  if (text) {
    return { mode: "plain_text", content: text };
  }

  return { mode: "empty", content: "" };
}

export function isSafePlainTextUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
