export { CUSTOMER_SOURCE_OTHER_KEY } from "@/lib/constants/customer-sources";

export const CUSTOMER_TAG_AUDIT_ACTIONS = {
  created: "customer_tag.created",
  updated: "customer_tag.updated",
  deleted: "customer_tag.deleted",
} as const;

export const CUSTOMER_TAG_ERROR_CODES = {
  NOT_FOUND: "CUSTOMER_TAG_NOT_FOUND",
  LABEL_REQUIRED: "CUSTOMER_TAG_LABEL_REQUIRED",
  LABEL_TOO_SHORT: "CUSTOMER_TAG_LABEL_TOO_SHORT",
  KEY_CONFLICT: "CUSTOMER_TAG_KEY_CONFLICT",
  CANNOT_DELETE_SYSTEM: "CANNOT_DELETE_SYSTEM_TAG",
  CANNOT_DELETE_OTHER: "CANNOT_DELETE_OTHER_TAG",
} as const;
