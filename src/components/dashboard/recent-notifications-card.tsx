import Link from "next/link";
import { Card } from "@/components/ui/card";
import { getDb } from "@/lib/db";
import {
  getNotificationHref,
  getUnreadNotificationCount,
  listNotificationsForUser,
} from "@/lib/notifications/queries";
import type { User } from "../../../drizzle/schema/users";

export async function RecentNotificationsCard({ user }: { user: User }) {
  const db = getDb();
  const [items, unreadCount] = await Promise.all([
    listNotificationsForUser(db, user.id, { limit: 5 }),
    getUnreadNotificationCount(db, user.id),
  ]);

  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-900">最近通知</h3>
        <span className="text-xs text-slate-500">
          未读 {unreadCount}
        </span>
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-slate-500">暂无通知</p>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => {
            const href = getNotificationHref(item, user.role);
            const inner = (
              <div
                className={
                  item.is_read
                    ? "rounded-lg border border-slate-100 bg-slate-50 px-3 py-2"
                    : "rounded-lg border border-indigo-100 bg-indigo-50/50 px-3 py-2"
                }
              >
                <p className="text-sm font-medium text-slate-900">{item.title}</p>
                <p className="mt-0.5 line-clamp-2 text-xs text-slate-600">
                  {item.message}
                </p>
                <p className="mt-1 text-xs text-slate-400">
                  {item.created_at.slice(0, 16).replace("T", " ")}
                  {!item.is_read && (
                    <span className="ml-2 font-medium text-indigo-600">未读</span>
                  )}
                </p>
              </div>
            );
            return (
              <li key={item.id}>
                {href ? (
                  <Link href={href} className="block hover:opacity-90">
                    {inner}
                  </Link>
                ) : (
                  inner
                )}
              </li>
            );
          })}
        </ul>
      )}
      <Link
        href="/notifications"
        className="mt-4 inline-block text-sm text-indigo-600 hover:underline"
      >
        进入通知中心 →
      </Link>
    </Card>
  );
}
