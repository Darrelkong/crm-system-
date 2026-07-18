import { Suspense } from "react";
import { cookies, headers } from "next/headers";
import {
  shouldRequireCloudflareAccess,
  validateAccessLoginWindow,
} from "@/lib/auth/access-jwt";
import { resolveIdleReloginState } from "@/lib/auth/idle-relogin-cookie";
import { AccessExpiredGate } from "@/components/auth/access-expired-gate";
import { LoginForm } from "./login-form";
import { LoginLoadingFallback } from "./login-loading";

export default async function LoginPage() {
  const hdrs = await headers();
  const cookieStore = await cookies();

  if (shouldRequireCloudflareAccess(hdrs)) {
    const accessWindow = await validateAccessLoginWindow(hdrs);
    if (!accessWindow.ok) {
      return <AccessExpiredGate />;
    }

    const idleState = await resolveIdleReloginState(hdrs, cookieStore);
    if (idleState.requiresAccessReverify) {
      return <AccessExpiredGate />;
    }
  }

  return (
    <Suspense fallback={<LoginLoadingFallback />}>
    <LoginForm />
    </Suspense>
  );
}
