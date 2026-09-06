export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";

export default function AdminCollaborativeDryRunPage() {
  redirect("/admin/reclamation/collaborative-reminders");
}
