import { Suspense } from "react";
import { headers } from "next/headers";
import { validateAccessLoginWindow } from "@/lib/auth/access-jwt";
import { AccessExpiredGate } from "@/components/auth/access-expired-gate";
import { LoginForm } from "./login-form";
import { LoginLoadingFallback } from "./login-loading";

export default async function LoginPage() {
  const hdrs = await headers();
  const accessWindow = validateAccessLoginWindow(hdrs);

  if (!accessWindow.ok) {
    return <AccessExpiredGate />;
  }

  return (
    <Suspense fallback={<LoginLoadingFallback />}>
      <LoginForm />
    </Suspense>
  );
}
