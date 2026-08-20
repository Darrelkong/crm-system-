import type { MailMessage, MailPrototypeScenario } from "./types";
import { getVisibleCustomerMatches } from "./recipient-permissions";

export function matchesMessageSearch(
  message: MailMessage,
  query: string,
  scenario: MailPrototypeScenario,
  noteContents: string[] = [],
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;

  const haystacks: string[] = [
    message.fromName,
    message.fromEmail,
    message.subject,
    message.body,
    message.preview,
    ...message.to,
    ...(message.cc ?? []),
    ...(message.bcc ?? []),
    ...message.attachments.map((a) => a.name),
    ...noteContents,
  ];

  if (message.customerMatch) {
    const visible = getVisibleCustomerMatches(message.fromEmail, scenario);
    if (visible.some((c) => c.id === message.customerMatch?.id)) {
      haystacks.push(message.customerMatch.name);
    }
  }

  for (const addr of [...message.to, message.fromEmail]) {
    const matches = getVisibleCustomerMatches(addr, scenario);
    for (const c of matches) {
      haystacks.push(c.name, c.customerCode);
    }
  }

  return haystacks.some((h) => h.toLowerCase().includes(q));
}
