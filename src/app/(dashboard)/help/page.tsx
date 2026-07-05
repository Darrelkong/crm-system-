export const dynamic = "force-dynamic";

import { requireAuthCached } from "@/lib/auth/request-cache";
import { HelpClient } from "./help-client";

export default async function HelpPage() {
  const user = await requireAuthCached();

  return <HelpClient role={user.role} />;
}
