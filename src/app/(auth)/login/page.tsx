import { Suspense } from "react";
import { headers } from "next/headers";
import {
  shouldRequireCloudflareAccess,
  validateAccessLoginWindow,
} from "@/lib/auth/access-jwt";
import { AccessExpiredGate } from "@/components/auth/access-expired-gate";
import { LoginForm } from "./login-form";
import { LoginLoadingFallback } from "./login-loading";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string | string[] | undefined }>;
}) {
  const hdrs = await headers();
  const params = await searchParams;
  const isCrmTimeout = params.reason === "timeout";

  // A CRM idle expiry must render the CRM login form even when the Access
  // assertion is not forwarded on this navigation. Login POST still performs
  // the authoritative Access JWT validation and email binding.
  if (!isCrmTimeout && shouldRequireCloudflareAccess(hdrs)) {
    const accessWindow = await validateAccessLoginWindow(hdrs);
    if (!accessWindow.ok) {
      return <AccessExpiredGate />;
    }
  }

  return (
    <Suspense fallback={<LoginLoadingFallback />}>
    <LoginForm />
    </Suspense>
  );
}
