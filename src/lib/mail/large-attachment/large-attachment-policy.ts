import { ORDINARY_EMAIL_RAW_ATTACHMENT_AGGREGATE_LIMIT_BYTES } from "@/lib/mail/outbound-provider-size-constants";

export const LARGE_ATTACHMENT_MAX_FILE_BYTES = 100 * 1024 * 1024;

export const LARGE_ATTACHMENT_MAX_AGGREGATE_BYTES = 300 * 1024 * 1024;

export const TOTAL_COMPOSE_ATTACHMENT_MAX_COUNT = 10;

/** Re-export direct budget — do not duplicate a conflicting constant. */
export const DIRECT_COMPOSE_ATTACHMENT_AGGREGATE_BYTES =
  ORDINARY_EMAIL_RAW_ATTACHMENT_AGGREGATE_LIMIT_BYTES;

export {
  ORDINARY_EMAIL_RAW_ATTACHMENT_AGGREGATE_LIMIT_BYTES,
} from "@/lib/mail/outbound-provider-size-constants";
