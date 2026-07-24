/** AI pipeline safety caps — context size, response size, parser complexity. */

/** Maximum characters for customer.notes sent to the AI provider. */
export const AI_CONTEXT_NOTES_MAX_CHARS = 2000;

/** Maximum characters for customer.sourceRemark sent to the AI provider. */
export const AI_CONTEXT_SOURCE_REMARK_MAX_CHARS = 500;

/** Maximum characters per follow-up summary sent to the AI provider. */
export const AI_CONTEXT_FOLLOW_UP_SUMMARY_MAX_CHARS = 1000;

/** Maximum characters per follow-up customerIntent sent to the AI provider. */
export const AI_CONTEXT_FOLLOW_UP_INTENT_MAX_CHARS = 500;

/** Maximum characters per follow-up next_action sent to the AI provider. */
export const AI_CONTEXT_FOLLOW_UP_NEXT_ACTION_MAX_CHARS = 500;

/** Suffix appended to a field value that was truncated before sending to the AI provider. */
export const AI_CONTEXT_TRUNCATION_SUFFIX = "…[truncated]";

/** Maximum character length of a provider response content string. Responses longer than this are
 *  rejected immediately without entering the parser or Zod validation. */
export const AI_PROVIDER_MAX_RESPONSE_CHARS = 20_000;

/** Maximum number of balanced-JSON-object candidates the scanner will evaluate.
 *  Limits worst-case CPU when the content contains many '{' characters. */
export const AI_PROVIDER_SCANNER_MAX_CANDIDATES = 20;
