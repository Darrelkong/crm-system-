export type ComposeBodyMode = "new" | "reply" | "reply_all" | "forward";

export type SplitComposeBodyResult = {
  editableHtml: string;
  quotedHtml: string | null;
};

const REPLY_QUOTE_MARKER_RE =
  /<p>\s*On\s+.+?\s+wrote:\s*<\/p>\s*(?:<blockquote[\s>][\s\S]*<\/blockquote>|<pre[\s>][\s\S]*<\/pre>)/i;

const FORWARD_QUOTE_MARKER_RE =
  /<p>\s*-{5,}\s*Forwarded message\s*-{5,}\s*<\/p>[\s\S]*/i;

function normalizeEditableHtml(html: string): string {
  let trimmed = html.trim();
  while (trimmed.endsWith("<p></p>")) {
    trimmed = trimmed.slice(0, -"<p></p>".length).trimEnd();
  }
  if (!trimmed || trimmed === "<p><br></p>") {
    return "";
  }
  return trimmed;
}

/**
 * Splits a persisted compose body into editable new content and a read-only quote
 * block for reply/forward composers. Legacy combined bodies without a detectable
 * marker remain fully editable.
 */
export function splitComposeBodyForEditor(input: {
  bodyHtml: string;
  composeMode: ComposeBodyMode;
}): SplitComposeBodyResult {
  const bodyHtml = input.bodyHtml ?? "";
  if (input.composeMode === "new" || !bodyHtml.trim()) {
    return { editableHtml: bodyHtml, quotedHtml: null };
  }

  if (input.composeMode === "reply" || input.composeMode === "reply_all") {
    const match = bodyHtml.match(REPLY_QUOTE_MARKER_RE);
    if (match && typeof match.index === "number") {
      const editableHtml = normalizeEditableHtml(bodyHtml.slice(0, match.index));
      const quotedHtml = bodyHtml.slice(match.index).trim();
      if (quotedHtml) {
        return { editableHtml, quotedHtml };
      }
    }
    return { editableHtml: bodyHtml, quotedHtml: null };
  }

  if (input.composeMode === "forward") {
    const match = bodyHtml.match(FORWARD_QUOTE_MARKER_RE);
    if (match && typeof match.index === "number") {
      const editableHtml = normalizeEditableHtml(bodyHtml.slice(0, match.index));
      const quotedHtml = bodyHtml.slice(match.index).trim();
      if (quotedHtml) {
        return { editableHtml, quotedHtml };
      }
    }
    return { editableHtml: bodyHtml, quotedHtml: null };
  }

  return { editableHtml: bodyHtml, quotedHtml: null };
}

/**
 * Recombines editable new content with the read-only quote block for persistence.
 * Preserves canonical reply/forward quote structure expected by outbound revision.
 */
export function mergeComposeBodyForSave(input: {
  editableHtml: string;
  quotedHtml: string | null;
  composeMode: ComposeBodyMode;
}): string {
  const quotedHtml = input.quotedHtml?.trim() ?? "";
  if (!quotedHtml || input.composeMode === "new") {
    return input.editableHtml;
  }

  const editableHtml = input.editableHtml.trim();
  if (!editableHtml) {
    return quotedHtml.startsWith("<p></p>") ? quotedHtml : `<p></p>${quotedHtml}`;
  }

  const separator = quotedHtml.startsWith("<p></p>") ? "" : "<p></p>";
  return `${editableHtml}${separator}${quotedHtml}`;
}

export function resolveComposeTitleKey(
  composeMode: ComposeBodyMode,
): "mail.compose.new" | "mail.compose.reply" | "mail.compose.forward" {
  if (composeMode === "reply" || composeMode === "reply_all") {
    return "mail.compose.reply";
  }
  if (composeMode === "forward") {
    return "mail.compose.forward";
  }
  return "mail.compose.new";
}
