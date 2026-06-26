import { getDb } from "@/lib/db";
import {
  getNotificationHref,
  getUnreadNotificationCount,
  listNotificationsForUser,
} from "@/lib/notifications/queries";
import type { User } from "../../../drizzle/schema/users";
import { RecentNotificationsCardClient } from "./recent-notifications-card-client";

function sortNotificationsUnreadFirst<
  T extends { is_read: boolean; created_at: string },
>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    if (a.is_read !== b.is_read) {
      return a.is_read ? 1 : -1;
    }
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });
}

export async function RecentNotificationsCard({ user }: { user: User }) {
  const db = getDb();
  const [items, unreadCount] = await Promise.all([
    listNotificationsForUser(db, user.id, { limit: 5 }),
    getUnreadNotificationCount(db, user.id),
  ]);

  const itemsWithHref = sortNotificationsUnreadFirst(items).map((item) => ({
    ...item,
    href: getNotificationHref(item, user.role),
  }));

  return (
    <RecentNotificationsCardClient
      items={itemsWithHref}
      unreadCount={unreadCount}
    />
  );
}
