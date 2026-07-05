import { redirect } from "next/navigation";
import { requireAuthCached } from "@/lib/auth/request-cache";
import { getDb } from "@/lib/db";
import { getLatestPublishedAnnouncementForUser } from "@/lib/announcements/service";
import { WelcomeClient } from "./welcome-client";
import { AdminWelcomeClient } from "./admin-welcome-client";

export const dynamic = "force-dynamic";

export default async function WelcomePage() {
  let user;
  try {
    user = await requireAuthCached();
  } catch {
    redirect("/login?redirect=/welcome");
  }

  const db = getDb();
  const announcement = await getLatestPublishedAnnouncementForUser(db, user);

  if (user.role === "admin") {
    return (
      <AdminWelcomeClient
        userName={user.displayName}
        announcement={announcement}
      />
    );
  }

  return (
    <WelcomeClient
      userName={user.displayName}
      announcement={announcement}
    />
  );
}
