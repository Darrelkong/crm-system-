export const dynamic = "force-dynamic";

import { requireAuthCached } from "@/lib/auth/request-cache";
import { AdminFollowUpsView } from "@/components/follow-ups/admin-follow-ups-view";
import { StaffFollowUpsView } from "@/components/follow-ups/staff-follow-ups-view";
import { parseFollowUpListFilters } from "@/lib/follow-ups/list-filters";

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function searchParamsToURLSearchParams(
  params: Record<string, string | string[] | undefined>,
): URLSearchParams {
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string") {
      sp.set(key, value);
    } else if (Array.isArray(value) && typeof value[0] === "string") {
      sp.set(key, value[0]);
    }
  }
  return sp;
}

export default async function FollowUpsPage({ searchParams }: Props) {
  const user = await requireAuthCached();
  const params = await searchParams;
  const initialFilters = parseFollowUpListFilters(
    searchParamsToURLSearchParams(params),
  );

  if (user.role === "admin") {
    return <AdminFollowUpsView initialFilters={initialFilters} />;
  }

  return <StaffFollowUpsView user={user} initialFilters={initialFilters} />;
}
