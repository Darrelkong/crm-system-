import { KNOWLEDGE_ERROR_CODES } from "@/lib/knowledge/constants";

export type KnowledgeTranslate = (
  key: string,
  params?: Record<string, string>,
) => string;

export type KnowledgeApiErrorPayload = {
  error?: string;
  errorCode?: string;
};

export const KNOWLEDGE_ERROR_I18N_KEYS: Record<string, string> = {
  [KNOWLEDGE_ERROR_CODES.NOT_INITIALIZED]: "knowledge.errors.notInitialized",
  [KNOWLEDGE_ERROR_CODES.ALREADY_INITIALIZED]:
    "knowledge.errors.alreadyInitialized",
  [KNOWLEDGE_ERROR_CODES.ACCESS_REQUIRED]: "knowledge.errors.accessRequired",
  [KNOWLEDGE_ERROR_CODES.ROLE_REQUIRED]: "knowledge.errors.roleRequired",
  [KNOWLEDGE_ERROR_CODES.ADMIN_REQUIRED]: "knowledge.errors.adminRequired",
  [KNOWLEDGE_ERROR_CODES.PASSWORD_REQUIRED]: "knowledge.errors.passwordRequired",
  [KNOWLEDGE_ERROR_CODES.PASSWORD_MISMATCH]: "knowledge.errors.passwordMismatch",
  [KNOWLEDGE_ERROR_CODES.PASSWORD_INVALID]: "knowledge.errors.passwordInvalid",
  [KNOWLEDGE_ERROR_CODES.PASSWORD_LOCKED]: "knowledge.errors.passwordLocked",
  [KNOWLEDGE_ERROR_CODES.PASSWORD_NOT_CONFIGURED]:
    "knowledge.errors.passwordNotConfigured",
  [KNOWLEDGE_ERROR_CODES.LAST_ADMIN]: "knowledge.errors.lastAdmin",
  [KNOWLEDGE_ERROR_CODES.ROLE_INVALID]: "knowledge.errors.roleInvalid",
  [KNOWLEDGE_ERROR_CODES.CATEGORY_INVALID]: "knowledge.errors.categoryInvalid",
  [KNOWLEDGE_ERROR_CODES.CATEGORY_NOT_FOUND]:
    "knowledge.errors.categoryNotFound",
  [KNOWLEDGE_ERROR_CODES.CATEGORY_HAS_ARTICLES]:
    "knowledge.errors.categoryHasArticles",
  [KNOWLEDGE_ERROR_CODES.CATEGORY_DELETE_DISABLED]:
    "knowledge.errors.categoryDeleteDisabled",
  [KNOWLEDGE_ERROR_CODES.ARTICLE_INVALID]: "knowledge.errors.articleInvalid",
  [KNOWLEDGE_ERROR_CODES.ARTICLE_NOT_FOUND]: "knowledge.errors.articleNotFound",
  [KNOWLEDGE_ERROR_CODES.ARTICLE_ACCESS_DENIED]:
    "knowledge.errors.articleAccessDenied",
  [KNOWLEDGE_ERROR_CODES.ARTICLE_CONFLICT]: "knowledge.errors.articleConflict",
  [KNOWLEDGE_ERROR_CODES.ARTICLE_NOT_EDITABLE]:
    "knowledge.errors.articleNotEditable",
  [KNOWLEDGE_ERROR_CODES.SOURCE_INVALID]: "knowledge.errors.sourceInvalid",
  [KNOWLEDGE_ERROR_CODES.SOURCE_NOT_FOUND]: "knowledge.errors.sourceNotFound",
  [KNOWLEDGE_ERROR_CODES.SOURCE_ACCESS_DENIED]:
    "knowledge.errors.sourceAccessDenied",
  [KNOWLEDGE_ERROR_CODES.SOURCE_ALREADY_CONVERTED]:
    "knowledge.errors.sourceAlreadyConverted",
  [KNOWLEDGE_ERROR_CODES.SOURCE_ALREADY_ARCHIVED]:
    "knowledge.errors.sourceAlreadyArchived",
  [KNOWLEDGE_ERROR_CODES.SOURCE_ARCHIVED]: "knowledge.errors.sourceArchived",
  [KNOWLEDGE_ERROR_CODES.SOURCE_NOT_ARCHIVED]:
    "knowledge.errors.sourceNotArchived",
  [KNOWLEDGE_ERROR_CODES.SOURCE_NOT_ARCHIVABLE]:
    "knowledge.errors.sourceNotArchivable",
  [KNOWLEDGE_ERROR_CODES.SOURCE_RESTORE_CONFLICT]:
    "knowledge.errors.sourceRestoreConflict",
  [KNOWLEDGE_ERROR_CODES.UNSUPPORTED_FILE_TYPE]:
    "knowledge.errors.unsupportedFileType",
  [KNOWLEDGE_ERROR_CODES.FILE_TOO_LARGE]: "knowledge.errors.fileTooLarge",
  [KNOWLEDGE_ERROR_CODES.MIME_MISMATCH]: "knowledge.errors.mimeMismatch",
  [KNOWLEDGE_ERROR_CODES.UNSAFE_FILENAME]: "knowledge.errors.unsafeFilename",
  [KNOWLEDGE_ERROR_CODES.TEXT_EXTRACTION_FAILED]:
    "knowledge.errors.textExtractionFailed",
  [KNOWLEDGE_ERROR_CODES.TEXT_EXTRACTION_UNAVAILABLE]:
    "knowledge.errors.textExtractionUnavailable",
  [KNOWLEDGE_ERROR_CODES.TEXT_EXTRACTION_TOO_LARGE]:
    "knowledge.errors.textExtractionTooLarge",
  [KNOWLEDGE_ERROR_CODES.SCANNED_PDF_UNSUPPORTED]:
    "knowledge.errors.scannedPdfUnsupported",
  [KNOWLEDGE_ERROR_CODES.PDF_PASSWORD_PROTECTED]:
    "knowledge.errors.pdfPasswordProtected",
  [KNOWLEDGE_ERROR_CODES.SOURCE_DUPLICATE]:
    "knowledge.errors.sourceDuplicate",
  [KNOWLEDGE_ERROR_CODES.AI_ORGANIZATION_FAILED]:
    "knowledge.errors.aiOrganizationFailed",
  [KNOWLEDGE_ERROR_CODES.AI_OUTPUT_INVALID]: "knowledge.errors.aiOutputInvalid",
  [KNOWLEDGE_ERROR_CODES.AI_RUN_CONFLICT]: "knowledge.errors.aiRunConflict",
  [KNOWLEDGE_ERROR_CODES.STORAGE_UNAVAILABLE]:
    "knowledge.errors.storageUnavailable",
  [KNOWLEDGE_ERROR_CODES.REVIEW_INVALID]: "knowledge.errors.reviewInvalid",
  [KNOWLEDGE_ERROR_CODES.REVIEW_NOT_FOUND]: "knowledge.errors.reviewNotFound",
  [KNOWLEDGE_ERROR_CODES.REVIEW_ACCESS_DENIED]:
    "knowledge.errors.reviewAccessDenied",
  [KNOWLEDGE_ERROR_CODES.REVIEW_CONFLICT]: "knowledge.errors.reviewConflict",
  [KNOWLEDGE_ERROR_CODES.REVIEW_NOTE_REQUIRED]:
    "knowledge.errors.reviewNoteRequired",
  [KNOWLEDGE_ERROR_CODES.REVIEW_SELF_APPROVAL]:
    "knowledge.errors.reviewSelfApproval",
  [KNOWLEDGE_ERROR_CODES.REVIEW_ARCHIVED]: "knowledge.errors.reviewArchived",
  [KNOWLEDGE_ERROR_CODES.REVIEW_ASSIGNMENT_INVALID]:
    "knowledge.errors.reviewAssignmentInvalid",
  [KNOWLEDGE_ERROR_CODES.SEARCH_INVALID]: "knowledge.errors.searchInvalid",
  [KNOWLEDGE_ERROR_CODES.AI_RATE_LIMITED]: "knowledge.errors.aiRateLimited",
  [KNOWLEDGE_ERROR_CODES.AI_BUSY]: "knowledge.errors.aiBusy",
  [KNOWLEDGE_ERROR_CODES.AI_TIMEOUT]: "knowledge.errors.aiTimeout",
  [KNOWLEDGE_ERROR_CODES.AI_PROVIDER_FAILED]:
    "knowledge.errors.aiProviderFailed",
  [KNOWLEDGE_ERROR_CODES.AI_QA_OUTPUT_INVALID]:
    "knowledge.errors.aiQaOutputInvalid",
  [KNOWLEDGE_ERROR_CODES.AI_NO_SOURCES]: "knowledge.errors.aiNoSources",
  [KNOWLEDGE_ERROR_CODES.AI_CITATION_INVALID]:
    "knowledge.errors.aiCitationInvalid",
};

export class KnowledgeApiClientError extends Error {
  constructor(public readonly errorCode?: string) {
    super("Knowledge API error");
    this.name = "KnowledgeApiClientError";
  }
}

export function getKnowledgeErrorMessage(
  t: KnowledgeTranslate,
  errorCode?: string | null,
): string {
  if (errorCode && KNOWLEDGE_ERROR_I18N_KEYS[errorCode]) {
    return t(KNOWLEDGE_ERROR_I18N_KEYS[errorCode]);
  }
  return t("knowledge.errors.generic");
}

export function resolveKnowledgeApiError(
  t: KnowledgeTranslate,
  payload: KnowledgeApiErrorPayload,
  fallbackKey = "knowledge.errors.generic",
): string {
  if (payload.errorCode) {
    return getKnowledgeErrorMessage(t, payload.errorCode);
  }
  return t(fallbackKey);
}
