import { FollowUpsListClient } from "@/components/follow-ups/follow-ups-list-client";
import { listFollowUpsForAdmin } from "@/lib/follow-ups/list-queries";
import { getDb } from "@/lib/db";

export async function AdminFollowUpsView() {
  const db = getDb();
  const items = await listFollowUpsForAdmin(db);

  return <FollowUpsListClient items={items} role="admin" />;
}
