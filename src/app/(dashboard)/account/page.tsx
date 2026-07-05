export const dynamic = "force-dynamic";

import { requireAuthCached } from "@/lib/auth/request-cache";
import { AccountPageClient } from "./account-page-client";

export default async function AccountPage() {
  const user = await requireAuthCached();

  return (
    <AccountPageClient
      displayName={user.displayName}
      email={user.email}
      role={user.role}
    />
  );
}
