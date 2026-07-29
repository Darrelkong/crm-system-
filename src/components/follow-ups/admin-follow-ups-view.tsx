import { FollowUpsListClient } from "@/components/follow-ups/follow-ups-list-client";
import {
  FOLLOW_UPS_LIST_LIMIT,
  listFollowUpsForAdmin,
} from "@/lib/follow-ups/list-queries";
import type { FollowUpListFilters } from "@/lib/follow-ups/list-filters";
import { getDb } from "@/lib/db";

export async function AdminFollowUpsView({
  initialFilters,
}: {
  initialFilters: FollowUpListFilters;
}) {
  const db = getDb();
  const items = await listFollowUpsForAdmin(db);

  return (
    <FollowUpsListClient
      items={items}
      role="admin"
      initialFilters={initialFilters}
      listLimit={FOLLOW_UPS_LIST_LIMIT}
    />
  );
}
