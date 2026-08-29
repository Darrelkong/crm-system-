import type { ComposeEditorState } from "@/lib/mail/client/draft-management";

export type ComposeDraftPersistenceErrorCode =
  | "MISSING_FROM"
  | "DRAFT_SAVE_FAILED"
  | "DRAFT_NOT_PERSISTED";

export class ComposeDraftPersistenceError extends Error {
  readonly code: ComposeDraftPersistenceErrorCode;

  constructor(code: ComposeDraftPersistenceErrorCode, message: string) {
    super(message);
    this.name = "ComposeDraftPersistenceError";
    this.code = code;
  }
}

export function composeDraftPersistenceMessageKey(
  code: ComposeDraftPersistenceErrorCode,
): string {
  switch (code) {
    case "MISSING_FROM":
      return "mail.compose.attachment.missingFrom";
    case "DRAFT_NOT_PERSISTED":
      return "mail.compose.attachment.draftNotSavedDetail";
    case "DRAFT_SAVE_FAILED":
    default:
      return "mail.compose.attachment.draftSaveFailed";
  }
}

export function resolvePersistedDraftId(
  state: Pick<ComposeEditorState, "draftId">,
): string | null {
  const draftId = state.draftId?.trim();
  return draftId ? draftId : null;
}
