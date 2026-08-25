import { SEED_IDS } from "@/lib/constants/seed-ids";

/** Deterministic namespace for Phase 2H-3D-2B-5B local verification fixtures. */
export const LOCAL_MAIL_VERIFY_FIXTURE_PREFIX = "LOCAL_MAIL_VERIFY_2H3D5B";

export const LOCAL_MAIL_VERIFY_OPT_IN_ENV =
  "CRM_ALLOW_LOCAL_MAIL_VERIFY_FIXTURE" as const;

export const LOCAL_MAIL_VERIFY_FIXTURE_ACTORS = {
  admin: SEED_IDS.admin,
  staffA: SEED_IDS.staffA,
  staffB: SEED_IDS.staffB,
} as const;

export const LOCAL_MAIL_VERIFY_MAILBOX_IDS = {
  staffPersonal: `${LOCAL_MAIL_VERIFY_FIXTURE_PREFIX}-MB-STAFF-PERSONAL`,
  shared: `${LOCAL_MAIL_VERIFY_FIXTURE_PREFIX}-MB-SHARED`,
} as const;

export const LOCAL_MAIL_VERIFY_SENDER_IDENTITY_ID = `${LOCAL_MAIL_VERIFY_FIXTURE_PREFIX}-SENDER-IDENTITY`;

export const LOCAL_MAIL_VERIFY_MESSAGE_IDS = {
  inboxBasic: `${LOCAL_MAIL_VERIFY_FIXTURE_PREFIX}-MSG-INBOX-BASIC`,
  inboxHtml: `${LOCAL_MAIL_VERIFY_FIXTURE_PREFIX}-MSG-INBOX-HTML`,
  inboxQuoted: `${LOCAL_MAIL_VERIFY_FIXTURE_PREFIX}-MSG-INBOX-QUOTED`,
  inboxAttachment: `${LOCAL_MAIL_VERIFY_FIXTURE_PREFIX}-MSG-INBOX-ATTACHMENT`,
  sent: `${LOCAL_MAIL_VERIFY_FIXTURE_PREFIX}-MSG-SENT`,
  trash: `${LOCAL_MAIL_VERIFY_FIXTURE_PREFIX}-MSG-TRASH`,
  sharedInbox: `${LOCAL_MAIL_VERIFY_FIXTURE_PREFIX}-MSG-SHARED-INBOX`,
  sharedBcc: `${LOCAL_MAIL_VERIFY_FIXTURE_PREFIX}-MSG-SHARED-BCC`,
} as const;

export const LOCAL_MAIL_VERIFY_ADDRESSES = {
  staffPersonalMailbox: "local-mail-verify-2h3d5b-staff-a@echfronthk.com",
  sharedMailbox: "local-mail-verify-2h3d5b-shared@echfronthk.com",
  senderIdentity: "local-mail-verify-2h3d5b-sender@echfronthk.com",
  inboundSender: "local-mail-verify-2h3d5b-inbound@echfronthk.test",
  toRecipient: "local-mail-verify-2h3d5b-to@echfronthk.test",
  ccRecipient: "local-mail-verify-2h3d5b-cc@echfronthk.test",
  bccRecipient: "local-mail-verify-2h3d5b-bcc@echfronthk.test",
} as const;

/** Fixed UTC base for deterministic ordering. */
export const LOCAL_MAIL_VERIFY_TIMESTAMP_BASE = "2026-08-23T12:00:00.000Z";

export function fixtureTimestamp(offsetMinutes: number): string {
  const baseMs = Date.parse(LOCAL_MAIL_VERIFY_TIMESTAMP_BASE);
  return new Date(baseMs - offsetMinutes * 60_000).toISOString();
}

export const LOCAL_MAIL_VERIFY_SUBJECT_PREFIX = "[LOCAL VERIFY]";

export function fixtureSubject(label: string): string {
  return `${LOCAL_MAIL_VERIFY_SUBJECT_PREFIX} ${label}`;
}
