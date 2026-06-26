"use client";

import { Card, EmptyState } from "@/components/ui/card";
import { PageIntro } from "@/components/ui/page-intro";
import { SimpleBarRow } from "@/components/dashboard/dashboard-widgets";
import { useTranslation } from "@/i18n/provider";
import { useCustomerLabels } from "@/i18n/use-customer-labels";
import type { TagsStagesOverview } from "@/lib/tags-stages/types";

function StatusBadge({
  label,
  variant,
}: {
  label: string;
  variant: "default" | "warning" | "accent";
}) {
  const styles = {
    default: "bg-[#E8F1FA] text-[#2F6FB3]",
    warning: "bg-amber-50 text-amber-800",
    accent: "bg-[#EEF3F8] text-[#6B7890]",
  };

  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${styles[variant]}`}
    >
      {label}
    </span>
  );
}

export function TagsStagesClient({ data }: { data: TagsStagesOverview }) {
  const { t } = useTranslation();
  const { salesStage, source } = useCustomerLabels();

  const maxStageCount = Math.max(...data.stages.map((s) => s.customerCount), 1);
  const maxTagCount = Math.max(...data.tags.map((s) => s.customerCount), 1);

  const stageStatusLabel = (status: string) => {
    if (status === "active") return t("tagsStagesPage.statusActive");
    if (status === "legacy") return t("tagsStagesPage.statusLegacy");
    return t("tagsStagesPage.statusCustom");
  };

  const stageStatusVariant = (status: string) => {
    if (status === "active") return "default" as const;
    if (status === "legacy") return "warning" as const;
    return "accent" as const;
  };

  const tagStatusLabel = (status: string) =>
    status === "active"
      ? t("tagsStagesPage.statusActive")
      : t("tagsStagesPage.statusCustom");

  return (
    <div className="space-y-6">
      <PageIntro
        title={t("tagsStagesPage.title")}
        description={t("tagsStagesPage.description")}
      />

      <Card className="border-[#E8F1FA] bg-[#F8FBFF] p-4 sm:p-5">
        <p className="text-sm leading-relaxed text-[#3D4A5C]">
          {t("tagsStagesPage.readOnlyNotice")}
        </p>
      </Card>

      <Card className="p-4 sm:p-6">
        <h2 className="text-base font-semibold text-[#172033]">
          {t("tagsStagesPage.customerStages")}
        </h2>
        <p className="mt-1 text-sm text-[#6B7890]">
          {t("tagsStagesPage.stagesHint")}
        </p>

        {data.stages.length === 0 ? (
          <div className="mt-4">
            <EmptyState message={t("tagsStagesPage.noStages")} />
          </div>
        ) : (
          <>
            <div className="mt-4 space-y-3 md:hidden">
              {data.stages.map((item) => (
                <div
                  key={item.key}
                  className="rounded-xl border border-[#E3E8F0] bg-white p-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium text-[#172033]">
                      {salesStage(item.key)}
                    </span>
                    <StatusBadge
                      label={stageStatusLabel(item.status)}
                      variant={stageStatusVariant(item.status)}
                    />
                  </div>
                  <p className="mt-2 text-xs text-[#6B7890]">
                    {t("tagsStagesPage.sortOrder")}:{" "}
                    {item.sortOrder ?? t("tagsStagesPage.notApplicable")}
                  </p>
                  <p className="mt-1 text-sm text-[#172033]">
                    {t("tagsStagesPage.customerCount")}: {item.customerCount}
                  </p>
                </div>
              ))}
            </div>

            <div className="mt-4 hidden overflow-x-auto md:block">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b border-[#E3E8F0] text-left text-[#6B7890]">
                    <th className="pb-2.5 pr-3 text-xs font-semibold uppercase tracking-wide">
                      {t("tagsStagesPage.sortOrder")}
                    </th>
                    <th className="pb-2.5 pr-3 text-xs font-semibold uppercase tracking-wide">
                      {t("tagsStagesPage.customerStages")}
                    </th>
                    <th className="pb-2.5 pr-3 text-xs font-semibold uppercase tracking-wide">
                      {t("tagsStagesPage.status")}
                    </th>
                    <th className="pb-2.5 text-xs font-semibold uppercase tracking-wide">
                      {t("tagsStagesPage.customerCount")}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#EEF3F8]">
                  {data.stages.map((item) => (
                    <tr key={item.key} className="hover:bg-[#E8F1FA]">
                      <td className="py-3 pr-3 text-[#6B7890]">
                        {item.sortOrder ?? "—"}
                      </td>
                      <td className="py-3 pr-3 font-medium text-[#172033]">
                        {salesStage(item.key)}
                        <span className="ml-2 font-mono text-xs text-[#6B7890]">
                          {item.key}
                        </span>
                      </td>
                      <td className="py-3 pr-3">
                        <StatusBadge
                          label={stageStatusLabel(item.status)}
                          variant={stageStatusVariant(item.status)}
                        />
                      </td>
                      <td className="py-3 font-semibold text-[#172033]">
                        {item.customerCount}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-6 space-y-3">
              {data.stages.map((item) => (
                <SimpleBarRow
                  key={`bar-${item.key}`}
                  label={salesStage(item.key)}
                  count={item.customerCount}
                  max={maxStageCount}
                />
              ))}
            </div>
          </>
        )}
      </Card>

      <Card className="p-4 sm:p-6">
        <h2 className="text-base font-semibold text-[#172033]">
          {t("tagsStagesPage.customerTags")}
        </h2>
        <p className="mt-1 text-sm text-[#6B7890]">
          {t("tagsStagesPage.tagsHint")}
        </p>

        {data.tags.length === 0 ? (
          <div className="mt-4">
            <EmptyState message={t("tagsStagesPage.noTags")} />
          </div>
        ) : (
          <>
            <div className="mt-4 space-y-3 md:hidden">
              {data.tags.map((item) => (
                <div
                  key={item.key}
                  className="rounded-xl border border-[#E3E8F0] bg-white p-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium text-[#172033]">
                      {source(item.key)}
                    </span>
                    <StatusBadge
                      label={tagStatusLabel(item.status)}
                      variant={item.status === "active" ? "default" : "accent"}
                    />
                  </div>
                  <p className="mt-2 text-sm text-[#172033]">
                    {t("tagsStagesPage.customerCount")}: {item.customerCount}
                  </p>
                </div>
              ))}
            </div>

            <div className="mt-4 hidden overflow-x-auto md:block">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="border-b border-[#E3E8F0] text-left text-[#6B7890]">
                    <th className="pb-2.5 pr-3 text-xs font-semibold uppercase tracking-wide">
                      {t("tagsStagesPage.customerTags")}
                    </th>
                    <th className="pb-2.5 pr-3 text-xs font-semibold uppercase tracking-wide">
                      {t("tagsStagesPage.status")}
                    </th>
                    <th className="pb-2.5 text-xs font-semibold uppercase tracking-wide">
                      {t("tagsStagesPage.customerCount")}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#EEF3F8]">
                  {data.tags.map((item) => (
                    <tr key={item.key} className="hover:bg-[#E8F1FA]">
                      <td className="py-3 pr-3 font-medium text-[#172033]">
                        {source(item.key)}
                        <span className="ml-2 font-mono text-xs text-[#6B7890]">
                          {item.key}
                        </span>
                      </td>
                      <td className="py-3 pr-3">
                        <StatusBadge
                          label={tagStatusLabel(item.status)}
                          variant={item.status === "active" ? "default" : "accent"}
                        />
                      </td>
                      <td className="py-3 font-semibold text-[#172033]">
                        {item.customerCount}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-6 space-y-3">
              {data.tags.map((item) => (
                <SimpleBarRow
                  key={`tag-bar-${item.key}`}
                  label={source(item.key)}
                  count={item.customerCount}
                  max={maxTagCount}
                />
              ))}
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
