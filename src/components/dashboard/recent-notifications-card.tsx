import { getDb } from "@/lib/db";
import {
  getNotificationHref,
  getUnreadNotificationCount,
  listNotificationsForUser,
} from "@/lib/notifications/queries";
import type { User } from "../../../drizzle/schema/users";
import { RecentNotificationsCardClient } from "./recent-notifications-card-client";

export async function RecentNotificationsCard({ user }: { user: User }) {
  const db = getDb();
  const [items, unreadCount] = await Promise.all([
    listNotificationsForUser(db, user.id, { limit: 5 }),
    getUnreadNotificationCount(db, user.id),
  ]);

  return (
    <RecentNotificationsCardClient
      items={items}
      unreadCount={unreadCount}
      getHref={(item) => getNotificationHref(item, user.role)}
    />
  );
}
