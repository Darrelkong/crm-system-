import Link from "next/link";
import { Card } from "@/components/ui/card";
import { getDb } from "@/lib/db";
import { listPublishedAnnouncementsForUser } from "@/lib/announcements/service";
import { formatHongKongDateTime } from "@/lib/timezone";
import type { User } from "../../../drizzle/schema/users";

export async function RecentAnnouncementsCard({ user }: { user: User }) {
  const db = getDb();
  const items = await listPublishedAnnouncementsForUser(db, user, 3);

  return (
    <Card>
      <h3 className="mb-3 text-sm font-semibold text-[#172033]">最新公告</h3>
      {items.length === 0 ? (
        <p className="text-sm text-[#6B7890]">暂无公告</p>
      ) : (
        <ul className="space-y-3">
          {items.map((item) => (
            <li
              key={item.id}
              className="surface-muted px-3 py-2"
            >
              <p className="text-sm font-medium text-[#172033]">{item.title}</p>
              <p className="mt-1 line-clamp-2 text-xs text-[#6B7890]">
                {item.content}
              </p>
              <p className="mt-1 text-xs text-[#6B7890]">
                {formatHongKongDateTime(item.published_at)}
              </p>
            </li>
          ))}
        </ul>
      )}
      <Link
        href="/announcements"
        className="mt-4 inline-block text-sm link-primary hover:underline"
      >
        查看全部公告 →
      </Link>
    </Card>
  );
}
