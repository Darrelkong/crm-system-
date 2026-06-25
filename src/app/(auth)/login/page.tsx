import { Suspense } from "react";
import { LoginForm } from "./login-form";
import { LoginLoadingFallback } from "./login-loading";

export default function LoginPage() {
  return (
    <Suspense fallback={<LoginLoadingFallback />}>
      <LoginForm />
    </Suspense>
  );
}
