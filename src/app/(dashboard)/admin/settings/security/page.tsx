export const dynamic = "force-dynamic";

import { SecurityPoliciesClient } from "./security-policies-client";
import { getIdleLogoutMinutes } from "@/lib/auth/session-policy";

export default async function AdminSecurityPoliciesPage() {
  const idleTimeoutMinutes = await getIdleLogoutMinutes();
  return <SecurityPoliciesClient idleTimeoutMinutes={idleTimeoutMinutes} />;
}
