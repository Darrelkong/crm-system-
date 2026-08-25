import { SEED_IDS } from "@/lib/constants/seed-ids";

/** Deterministic namespace for Phase 2H-6E local Reply / Forward verification. */
export const LOCAL_MAIL_REPLY_VERIFY_FIXTURE_PREFIX = "LOCAL_MAIL_REPLY_VERIFY_2H6E";

export const LOCAL_MAIL_REPLY_VERIFY_OPT_IN_ENV =
  "CRM_ALLOW_LOCAL_MAIL_REPLY_VERIFY_FIXTURE" as const;

export const LOCAL_MAIL_REPLY_VERIFY_FIXTURE_ACTORS = {
  admin: SEED_IDS.admin,
  staffA: SEED_IDS.staffA,
  staffB: SEED_IDS.staffB,
} as const;

export const LOCAL_MAIL_REPLY_VERIFY_MAILBOX_IDS = {
  staffA: `${LOCAL_MAIL_REPLY_VERIFY_FIXTURE_PREFIX}-MB-STAFF-A`,
  shared: `${LOCAL_MAIL_REPLY_VERIFY_FIXTURE_PREFIX}-MB-SHARED`,
} as const;

export const LOCAL_MAIL_REPLY_VERIFY_SENDER_IDENTITY_IDS = {
  staffA: `${LOCAL_MAIL_REPLY_VERIFY_FIXTURE_PREFIX}-SENDER-STAFF-A`,
  staffB: `${LOCAL_MAIL_REPLY_VERIFY_FIXTURE_PREFIX}-SENDER-STAFF-B`,
  shared: `${LOCAL_MAIL_REPLY_VERIFY_FIXTURE_PREFIX}-SENDER-SHARED`,
} as const;

export const LOCAL_MAIL_REPLY_VERIFY_CUSTOMER_IDS = {
  visible: `${LOCAL_MAIL_REPLY_VERIFY_FIXTURE_PREFIX}-CUST-VISIBLE`,
  hiddenPool: `${LOCAL_MAIL_REPLY_VERIFY_FIXTURE_PREFIX}-CUST-HIDDEN`,
} as const;

export const LOCAL_MAIL_REPLY_VERIFY_MESSAGE_IDS = {
  inboundReply: `${LOCAL_MAIL_REPLY_VERIFY_FIXTURE_PREFIX}-MSG-R1`,
  inboundReplyAll: `${LOCAL_MAIL_REPLY_VERIFY_FIXTURE_PREFIX}-MSG-R2`,
  sentReply: `${LOCAL_MAIL_REPLY_VERIFY_FIXTURE_PREFIX}-MSG-R3`,
  forward: `${LOCAL_MAIL_REPLY_VERIFY_FIXTURE_PREFIX}-MSG-R4`,
  sharedReply: `${LOCAL_MAIL_REPLY_VERIFY_FIXTURE_PREFIX}-MSG-R5`,
  crmVisible: `${LOCAL_MAIL_REPLY_VERIFY_FIXTURE_PREFIX}-MSG-R6`,
  crmHidden: `${LOCAL_MAIL_REPLY_VERIFY_FIXTURE_PREFIX}-MSG-R7`,
  trashReply: `${LOCAL_MAIL_REPLY_VERIFY_FIXTURE_PREFIX}-MSG-R8`,
  staffAOnly: `${LOCAL_MAIL_REPLY_VERIFY_FIXTURE_PREFIX}-MSG-R9`,
} as const;

export const LOCAL_MAIL_REPLY_VERIFY_ADDRESSES = {
  staffAMailbox: "local-mail-reply-verify-2h6e-staff-a@echfronthk.com",
  staffASender: "local-mail-reply-verify-2h6e-staff-a@echfronthk.com",
  staffBSender: "local-mail-reply-verify-2h6e-staff-b@echfronthk.com",
  sharedMailbox: "local-mail-reply-verify-2h6e-shared@echfronthk.com",
  sharedSender: "local-mail-reply-verify-2h6e-shared@echfronthk.com",
  externalSender: "local-mail-reply-verify-2h6e-external@echfronthk.test",
  colleague: "local-mail-reply-verify-2h6e-colleague@echfronthk.test",
  ccRecipient: "local-mail-reply-verify-2h6e-cc@echfronthk.test",
  bccRecipient: "local-mail-reply-verify-2h6e-bcc@echfronthk.test",
  clientRecipient: "local-mail-reply-verify-2h6e-client@echfronthk.test",
  crmVisibleEmail: "local-mail-reply-verify-2h6e-crm-visible@echfronthk.test",
  crmHiddenEmail: "local-mail-reply-verify-2h6e-crm-hidden@echfronthk.test",
} as const;

export const LOCAL_MAIL_REPLY_VERIFY_CUSTOMER_CODES = {
  visible: "LMRV2H6EV",
  hiddenPool: "LMRV2H6EH",
} as const;

export const LOCAL_MAIL_REPLY_VERIFY_TIMESTAMP_BASE = "2026-08-24T10:00:00.000Z";

export function replyFixtureTimestamp(offsetMinutes: number): string {
  const baseMs = Date.parse(LOCAL_MAIL_REPLY_VERIFY_TIMESTAMP_BASE);
  return new Date(baseMs - offsetMinutes * 60_000).toISOString();
}

export const LOCAL_MAIL_REPLY_VERIFY_SUBJECT_PREFIX = "[LOCAL REPLY VERIFY]";

export function replyFixtureSubject(label: string): string {
  return `${LOCAL_MAIL_REPLY_VERIFY_SUBJECT_PREFIX} ${label}`;
}

export const LOCAL_MAIL_REPLY_VERIFY_SUBJECTS = {
  inboundReply: replyFixtureSubject("Inbound Reply"),
  inboundReplyAll: replyFixtureSubject("Inbound Reply All"),
  sentReply: replyFixtureSubject("Sent Reply"),
  forward: replyFixtureSubject("Forward"),
  sharedReply: replyFixtureSubject("Shared Reply"),
  crmVisible: replyFixtureSubject("CRM Visible"),
  crmHidden: replyFixtureSubject("CRM Hidden"),
  trashReply: replyFixtureSubject("Trash Reply"),
  staffAOnly: replyFixtureSubject("Staff A Only"),
} as const;
