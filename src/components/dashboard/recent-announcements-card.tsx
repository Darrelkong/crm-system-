import { getDb } from "@/lib/db";
import { listPublishedAnnouncementsForUser } from "@/lib/announcements/service";
import type { User } from "../../../drizzle/schema/users";
import { RecentAnnouncementsCardClient } from "./recent-announcements-card-client";

export async function RecentAnnouncementsCard({ user }: { user: User }) {
  const db = getDb();
  const items = await listPublishedAnnouncementsForUser(db, user, 3);

  return (
    <RecentAnnouncementsCardClient
      items={items.map((item) => ({
        id: item.id,
        title: item.title,
        content: item.content,
        published_at: item.published_at,
      }))}
    />
  );
}
