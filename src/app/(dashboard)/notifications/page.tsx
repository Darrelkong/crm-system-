export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { WORK_ITEMS_NOTIFICATIONS_ALL_HREF } from "@/lib/work-items/url-state";

/** Legacy /notifications bookmarks → Action Center notifications tab. */
export default function NotificationsRedirectPage() {
  redirect(WORK_ITEMS_NOTIFICATIONS_ALL_HREF);
}
