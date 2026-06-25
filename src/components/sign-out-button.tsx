"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useTranslation } from "@/i18n/provider";

export function SignOutButton() {
  const router = useRouter();
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);

  async function handleSignOut() {
    setLoading(true);
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      onClick={handleSignOut}
      disabled={loading}
    >
      {loading ? t("auth.signingOut") : t("auth.signOut")}
    </Button>
  );
}
