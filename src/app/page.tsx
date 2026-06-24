import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { getRoleDashboardPath } from "@/lib/permissions/auth";

export default async function HomePage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }
  redirect(getRoleDashboardPath(user.role));
}
