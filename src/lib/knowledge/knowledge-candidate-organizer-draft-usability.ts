import type { OrganizerDraftFields } from "@/lib/knowledge/knowledge-ingest-organizer-draft";

export function isUsableCandidateOrganizerDraft(
  draft: OrganizerDraftFields | null | undefined,
): boolean {
  if (!draft) return false;
  return (
    draft.title.trim().length > 0 &&
    draft.summary.trim().length > 0 &&
    draft.body.trim().length > 0
  );
}
