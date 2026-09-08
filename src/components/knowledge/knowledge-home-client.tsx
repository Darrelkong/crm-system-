"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useTranslation } from "@/i18n/provider";

export function KnowledgeHomeClient() {
  const { t } = useTranslation();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function lockKnowledge() {
    setBusy(true);
    try {
      const response = await fetch("/api/knowledge/lock", { method: "POST" });
      if (response.ok) {
        router.replace("/knowledge/access");
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="max-w-2xl">
      <h2 className="text-lg font-semibold crm-text">
        {t("knowledge.placeholderTitle")}
      </h2>
      <p className="mt-2 text-sm crm-text-secondary">
        {t("knowledge.placeholderDescription")}
      </p>
      <Button
        type="button"
        variant="secondary"
        className="mt-6"
        onClick={lockKnowledge}
        disabled={busy}
      >
        {t("knowledge.lock")}
      </Button>
    </Card>
  );
}
