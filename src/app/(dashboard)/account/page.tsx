export const dynamic = "force-dynamic";

import { requireAuth } from "@/lib/permissions/auth";
import { AccountPageClient } from "./account-page-client";

export default async function AccountPage() {
  const user = await requireAuth();

  return (
    <AccountPageClient
      displayName={user.displayName}
      email={user.email}
      role={user.role}
    />
  );
}
