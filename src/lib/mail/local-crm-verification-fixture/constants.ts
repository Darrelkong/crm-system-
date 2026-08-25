import { SEED_IDS } from "@/lib/constants/seed-ids";

/** Deterministic namespace for Phase 2H-4B-2 local CRM + Mail verification. */
export const LOCAL_MAIL_CRM_VERIFY_FIXTURE_PREFIX = "LOCAL_MAIL_CRM_VERIFY_2H4B2";

export const LOCAL_MAIL_CRM_VERIFY_OPT_IN_ENV =
  "CRM_ALLOW_LOCAL_MAIL_CRM_VERIFY_FIXTURE" as const;

export const LOCAL_MAIL_CRM_VERIFY_FIXTURE_ACTORS = {
  admin: SEED_IDS.admin,
  staffA: SEED_IDS.staffA,
  staffB: SEED_IDS.staffB,
} as const;

export const LOCAL_MAIL_CRM_VERIFY_CUSTOMER_IDS = {
  accessibleA: `${LOCAL_MAIL_CRM_VERIFY_FIXTURE_PREFIX}-CUST-A`,
  publicPool: `${LOCAL_MAIL_CRM_VERIFY_FIXTURE_PREFIX}-CUST-POOL`,
  outboundManual: `${LOCAL_MAIL_CRM_VERIFY_FIXTURE_PREFIX}-CUST-OUTBOUND`,
} as const;

export const LOCAL_MAIL_CRM_VERIFY_MAILBOX_IDS = {
  shared: `${LOCAL_MAIL_CRM_VERIFY_FIXTURE_PREFIX}-MB-SHARED`,
} as const;

export const LOCAL_MAIL_CRM_VERIFY_SENDER_IDENTITY_ID = `${LOCAL_MAIL_CRM_VERIFY_FIXTURE_PREFIX}-SENDER-IDENTITY`;

export const LOCAL_MAIL_CRM_VERIFY_MESSAGE_IDS = {
  accessibleCustomer: `${LOCAL_MAIL_CRM_VERIFY_FIXTURE_PREFIX}-MSG-ACCESSIBLE`,
  publicPoolCustomer: `${LOCAL_MAIL_CRM_VERIFY_FIXTURE_PREFIX}-MSG-PUBLIC-POOL`,
  externalNoMatch: `${LOCAL_MAIL_CRM_VERIFY_FIXTURE_PREFIX}-MSG-NO-MATCH`,
  outboundManual: `${LOCAL_MAIL_CRM_VERIFY_FIXTURE_PREFIX}-MSG-OUTBOUND-MANUAL`,
} as const;

export const LOCAL_MAIL_CRM_VERIFY_ADDRESSES = {
  sharedMailbox: "local-mail-crm-verify-2h4b2-shared@echfronthk.com",
  senderIdentity: "local-mail-crm-verify-2h4b2-sender@echfronthk.com",
  customerAEmail: "local-mail-crm-verify-2h4b2-customer-a@echfronthk.test",
  publicPoolEmail: "local-mail-crm-verify-2h4b2-public-pool@echfronthk.test",
  externalNoMatchEmail: "local-mail-crm-verify-2h4b2-no-match@echfronthk.test",
  toRecipient: "local-mail-crm-verify-2h4b2-to@echfronthk.test",
} as const;

export const LOCAL_MAIL_CRM_VERIFY_CUSTOMER_CODES = {
  accessibleA: "LMCV2H4B2A",
  publicPool: "LMCV2H4B2P",
  outboundManual: "LMCV2H4B2O",
} as const;

export const LOCAL_MAIL_CRM_VERIFY_TIMESTAMP_BASE = "2026-08-23T14:30:00.000Z";

export function crmFixtureTimestamp(offsetMinutes: number): string {
  const baseMs = Date.parse(LOCAL_MAIL_CRM_VERIFY_TIMESTAMP_BASE);
  return new Date(baseMs - offsetMinutes * 60_000).toISOString();
}

export const LOCAL_MAIL_CRM_VERIFY_SUBJECT_PREFIX = "[LOCAL CRM VERIFY]";

export function crmFixtureSubject(label: string): string {
  return `${LOCAL_MAIL_CRM_VERIFY_SUBJECT_PREFIX} ${label}`;
}
