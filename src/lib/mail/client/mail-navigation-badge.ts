import { MAIL_PROTOTYPE_UNREAD_BADGE } from "@/lib/mail/prototype/mock-data";
import {
  resolveMailReadSourceFromEnv,
  usesProductionMailReadSource,
  type MailReadSource,
} from "./mail-read-source";

/**
 * Global Mail nav unread badge count.
 * Prototype: fixture badge. Production: hide until a canonical aggregate exists.
 */
export function resolveMailNavigationUnreadBadgeCount(
  source: MailReadSource = resolveMailReadSourceFromEnv(
    process.env.NEXT_PUBLIC_MAIL_READ_SOURCE,
  ),
): number | null {
  if (usesProductionMailReadSource(source)) {
    return null;
  }

  return MAIL_PROTOTYPE_UNREAD_BADGE;
}
