/** Avoid `Re: Re:` when replying. */
export function replySubject(subject: string): string {
  if (/^re:\s*/i.test(subject.trim())) return subject.trim();
  return `Re: ${subject.trim()}`;
}

/** Avoid `Fwd: Fwd:` when forwarding. */
export function forwardSubject(subject: string): string {
  if (/^fwd:\s*/i.test(subject.trim())) return subject.trim();
  return `Fwd: ${subject.trim()}`;
}
