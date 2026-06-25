"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useTranslation } from "@/i18n/provider";
import { performSecurityLogout } from "@/lib/auth/client-security";

export function SignOutButton() {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);

  async function handleSignOut() {
    setLoading(true);
    await performSecurityLogout("manual");
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
