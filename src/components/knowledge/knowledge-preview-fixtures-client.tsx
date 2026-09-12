"use client";

import Link from "next/link";
import { FileText } from "lucide-react";
import { useTranslation } from "@/i18n/provider";
import { KNOWLEDGE_PREVIEW_FIXTURES } from "@/lib/knowledge/knowledge-preview-fixtures";
import { Card } from "@/components/ui/card";

export function KnowledgePreviewFixturesClient() {
  const { t } = useTranslation();

  return (
    <div className="mx-auto min-w-0 max-w-xl space-y-4 px-4 py-6">
      <Card className="border-amber-200 bg-amber-50">
        <p className="text-sm leading-6 text-amber-950">
          {t("knowledge.previewFixtures.localOnlyNotice")}
        </p>
      </Card>
      <div className="space-y-3">
        {KNOWLEDGE_PREVIEW_FIXTURES.map((fixture) => (
          <Card key={fixture.id} className="min-w-0">
            <div className="flex min-w-0 items-start gap-3">
              <FileText className="mt-0.5 h-5 w-5 shrink-0 text-slate-500" aria-hidden />
              <div className="min-w-0 flex-1">
                <h2 className="text-base font-semibold crm-text">
                  {t(fixture.titleKey)}
                </h2>
                <p className="mt-1 text-sm crm-text-secondary">
                  {t(fixture.descriptionKey)}
                </p>
                <p className="mt-1 truncate text-xs crm-text-secondary">
                  {fixture.filename}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <a
                    href={`/local-preview/knowledge-fixtures/${fixture.id}`}
                    className="inline-flex min-h-9 items-center justify-center rounded-xl px-3 py-1.5 text-sm font-medium primary-button text-white"
                  >
                    {t("knowledge.previewFixtures.download")}
                  </a>
                </div>
              </div>
            </div>
          </Card>
        ))}
      </div>
      <p className="text-sm crm-text-secondary">
        <Link href="/knowledge/ingest" className="text-blue-700 underline">
          {t("knowledge.previewFixtures.backToIngest")}
        </Link>
      </p>
    </div>
  );
}
