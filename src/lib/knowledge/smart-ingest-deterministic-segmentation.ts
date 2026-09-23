/**
 * Gate 1: deterministic topic segmentation for pasted Knowledge sources.
 * Evidence spans are offsets into the exact source string passed in.
 */

export type DeterministicSegmentDraft = {
  segmentIndex: number;
  titleHint: string;
  evidenceStart: number;
  evidenceEnd: number;
};

const STRUCTURAL_HEADING =
  /^[一二三四五六七八九十百]+[、．.]\s*/;
const NUMBERED_LIST_LINE = /^\d+[.)、\]]\s*/;
const MARKDOWN_HEADING = /^#{1,6}\s+/;
const SECTION_LABEL =
  /^(资料|要求|限制|注意事项|资产|开户|说明|备注|流程|条件|材料)/;

function isTopicHeaderLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > 50) return false;
  if (trimmed.includes("\n")) return false;
  if (STRUCTURAL_HEADING.test(trimmed)) return false;
  if (NUMBERED_LIST_LINE.test(trimmed)) return false;
  if (MARKDOWN_HEADING.test(trimmed)) return false;
  if (SECTION_LABEL.test(trimmed)) return false;
  if (/^[-*•]\s/.test(trimmed)) return false;
  return true;
}

function isStructuralMarkdownHeading(line: string): boolean {
  const trimmed = line.trim();
  if (!MARKDOWN_HEADING.test(trimmed)) return false;
  const body = trimmed.replace(MARKDOWN_HEADING, "").trim();
  if (!body || body.length > 80) return false;
  if (STRUCTURAL_HEADING.test(body)) return false;
  if (SECTION_LABEL.test(body)) return false;
  return true;
}

function isBusinessMarkdownHeading(line: string): boolean {
  const trimmed = line.trim();
  if (!MARKDOWN_HEADING.test(trimmed)) return false;
  const body = trimmed.replace(MARKDOWN_HEADING, "").trim();
  if (!body || body.length > 80) return false;
  if (STRUCTURAL_HEADING.test(body)) return false;
  if (SECTION_LABEL.test(body)) return false;
  if (NUMBERED_LIST_LINE.test(body)) return false;
  return true;
}

function splitByHorizontalRules(text: string): Array<{ start: number; end: number }> {
  const separator = /\n---\s*\n/g;
  const spans: Array<{ start: number; end: number }> = [];
  let lastEnd = 0;
  let match: RegExpExecArray | null;
  while ((match = separator.exec(text)) !== null) {
    const ruleStart = match.index;
    if (ruleStart > lastEnd) {
      spans.push({ start: lastEnd, end: ruleStart });
    }
    lastEnd = match.index + match[0].length;
  }
  if (lastEnd < text.length) {
    spans.push({ start: lastEnd, end: text.length });
  }
  return spans.filter((span) => text.slice(span.start, span.end).trim().length > 0);
}

function trimSpan(text: string, start: number, end: number): { start: number; end: number } {
  let s = start;
  let e = end;
  while (s < e && /\s/.test(text[s]!) && text[s] !== "\n") s++;
  while (e > s && /\s/.test(text[e - 1]!) && text[e - 1] !== "\n") e--;
  while (s < e && text[s] === "\n") s++;
  while (e > s && text[e - 1] === "\n") e--;
  return { start: s, end: e };
}

function titleHintFromSpan(text: string, start: number, end: number, fallbackIndex: number): string {
  const chunk = text.slice(start, end);
  const lines = chunk.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (const line of lines) {
    if (isBusinessMarkdownHeading(line)) {
      return line.replace(MARKDOWN_HEADING, "").trim();
    }
    if (isTopicHeaderLine(line)) {
      return line.trim();
    }
    if (isStructuralMarkdownHeading(line)) {
      continue;
    }
    break;
  }
  return `业务片段 ${fallbackIndex + 1}`;
}

function splitSpanByMarkdownHeadingBoundaries(
  text: string,
  spanStart: number,
  spanEnd: number,
): Array<{ start: number; end: number }> {
  const chunk = text.slice(spanStart, spanEnd);
  const boundaries = [0];
  const boundaryPattern = /\n\n(?=#{1,6}\s)/g;
  let match: RegExpExecArray | null;
  while ((match = boundaryPattern.exec(chunk)) !== null) {
    const nextStart = match.index + match[0].length;
    if (nextStart > boundaries[boundaries.length - 1]!) {
      boundaries.push(nextStart);
    }
  }
  if (boundaries.length <= 1) {
    return [{ start: spanStart, end: spanEnd }];
  }
  boundaries.push(chunk.length);
  const spans: Array<{ start: number; end: number }> = [];
  for (let i = 0; i < boundaries.length - 1; i++) {
    const localStart = boundaries[i]!;
    const localEnd = boundaries[i + 1]!;
    if (localEnd > localStart) {
      spans.push({ start: spanStart + localStart, end: spanStart + localEnd });
    }
  }
  return spans.length > 0 ? spans : [{ start: spanStart, end: spanEnd }];
}

function splitSingleSpanByTopicHeaders(
  text: string,
  spanStart: number,
  spanEnd: number,
): Array<{ start: number; end: number }> {
  const mdSpans = splitSpanByMarkdownHeadingBoundaries(text, spanStart, spanEnd);
  if (mdSpans.length > 1) {
    return mdSpans.map((span) => trimSpan(text, span.start, span.end)).filter(
      (span) => text.slice(span.start, span.end).trim().length > 0,
    );
  }
  const chunk = text.slice(spanStart, spanEnd);
  const paragraphs: Array<{ localStart: number; localEnd: number; firstLine: string }> = [];
  let offset = 0;
  const parts = chunk.split(/\n\n+/);
  for (const part of parts) {
    const localStart = chunk.indexOf(part, offset);
    if (localStart < 0) continue;
    const localEnd = localStart + part.length;
    offset = localEnd;
    const firstLine = part.split(/\r?\n/)[0]?.trim() ?? "";
    paragraphs.push({ localStart, localEnd, firstLine });
  }
  if (paragraphs.length <= 1) {
    return [{ start: spanStart, end: spanEnd }];
  }

  const spans: Array<{ start: number; end: number }> = [];
  let currentStart = paragraphs[0]!.localStart;
  let currentParagraphs = 0;
  let currentChars = 0;

  for (let i = 0; i < paragraphs.length; i++) {
    const para = paragraphs[i]!;
    const paraText = chunk.slice(para.localStart, para.localEnd);
    const headerSplit =
      isTopicHeaderLine(para.firstLine) ||
      isBusinessMarkdownHeading(para.firstLine);
    const minCharsBeforeSplit = isBusinessMarkdownHeading(para.firstLine) ? 20 : 40;
    if (
      i > 0 &&
      headerSplit &&
      currentParagraphs > 0 &&
      currentChars >= minCharsBeforeSplit
    ) {
      const prevEnd = paragraphs[i - 1]!.localEnd;
      const trimmed = trimSpan(chunk, currentStart, prevEnd);
      if (trimmed.end > trimmed.start) {
        spans.push({
          start: spanStart + trimmed.start,
          end: spanStart + trimmed.end,
        });
      }
      currentStart = para.localStart;
      currentParagraphs = 0;
      currentChars = 0;
    }
    currentParagraphs += 1;
    currentChars += paraText.length;
  }
  const tail = trimSpan(chunk, currentStart, paragraphs[paragraphs.length - 1]!.localEnd);
  if (tail.end > tail.start) {
    spans.push({ start: spanStart + tail.start, end: spanStart + tail.end });
  }
  return spans.length > 0 ? spans : [{ start: spanStart, end: spanEnd }];
}

export function segmentKnowledgePasteTextDeterministic(
  rawText: string,
): DeterministicSegmentDraft[] {
  const text = rawText;
  if (!text.trim()) {
    return [];
  }

  let spans = splitByHorizontalRules(text);
  if (spans.length <= 1) {
    spans = [{ start: 0, end: text.length }];
    spans = splitSingleSpanByTopicHeaders(text, spans[0]!.start, spans[0]!.end);
  } else {
    spans = spans.flatMap((span) => {
      const trimmed = trimSpan(text, span.start, span.end);
      return splitSingleSpanByTopicHeaders(text, trimmed.start, trimmed.end);
    });
  }

  const normalized = spans
    .map((span) => trimSpan(text, span.start, span.end))
    .filter((span) => text.slice(span.start, span.end).trim().length > 0);

  if (normalized.length === 0) {
    return [];
  }

  return normalized.map((span, index) => ({
    segmentIndex: index,
    titleHint: titleHintFromSpan(text, span.start, span.end, index),
    evidenceStart: span.start,
    evidenceEnd: span.end,
  }));
}

export function materializeDeterministicSegments(
  rawText: string,
  drafts: DeterministicSegmentDraft[],
): Array<
  DeterministicSegmentDraft & {
    evidenceText: string;
  }
> {
  return drafts.map((draft) => {
    const evidenceText = rawText.slice(draft.evidenceStart, draft.evidenceEnd);
    if (evidenceText !== rawText.slice(draft.evidenceStart, draft.evidenceEnd)) {
      throw new Error("SEGMENTATION_EVIDENCE_MISMATCH");
    }
    return { ...draft, evidenceText };
  });
}
