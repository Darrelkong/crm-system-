export const dynamic = "force-dynamic";

import { listAuthorizedDevicesForAdmin } from "@/lib/devices/queries";
import { getDeviceSummariesForUsers } from "@/lib/devices/service";
import { requireDeviceAdmin } from "@/lib/permissions/devices";
import { authErrorResponse } from "@/lib/permissions/auth";

export async function GET(request: Request) {
  try {
    await requireDeviceAdmin(request);
    const url = new URL(request.url);
    const status = url.searchParams.get("status") ?? undefined;
    const userId = url.searchParams.get("userId") ?? undefined;
    const email = url.searchParams.get("email") ?? undefined;

    const items = await listAuthorizedDevicesForAdmin({
      status,
      userId,
      email,
      limit: 200,
    });

    const userIds = [...new Set(items.map((item) => item.user_id))];
    const summaries = await getDeviceSummariesForUsers(userIds);

    return Response.json({
      items,
      total: items.length,
      userSummaries: Object.fromEntries(summaries),
    });
  } catch (error) {
    return authErrorResponse(error);
  }
}
