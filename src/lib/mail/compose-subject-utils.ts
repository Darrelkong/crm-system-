/** Avoid `Re: Re:` when replying. */
export function replySubject(subject: string): string {
  const trimmed = subject.trim();
  if (/^re:\s*/i.test(trimmed)) {
    return trimmed;
  }
  return `Re: ${trimmed}`;
}

/** Avoid `Fwd: Fwd:` when forwarding. */
export function forwardSubject(subject: string): string {
  const trimmed = subject.trim();
  if (/^fwd:\s*/i.test(trimmed)) {
    return trimmed;
  }
  return `Fwd: ${trimmed}`;
}
