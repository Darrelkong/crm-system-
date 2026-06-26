export const dynamic = "force-dynamic";

import { requireAuth } from "@/lib/permissions/auth";
import { HelpClient } from "./help-client";

export default async function HelpPage() {
  const user = await requireAuth();

  return <HelpClient role={user.role} />;
}
