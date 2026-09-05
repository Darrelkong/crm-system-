import type { MailMailbox } from "../../../drizzle/schema/mail-mailboxes";

export type MailSourceMailboxView = {
  address: string;
  displayName: string | null;
  mailboxType: MailMailbox["mailboxType"];
};
