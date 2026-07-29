"use client";

import Link from "next/link";
import { Check } from "lucide-react";
import { useTranslation } from "@/i18n/provider";
import { getCustomerDisplayName } from "@/lib/customers/customer-display-name";
import { resolveRequestedProjectDisplayName } from "@/lib/customers/requested-project-display";
import { cn } from "@/lib/cn";

export type CustomerCreatedSummary = {
  customerId: string;
  customerName: string | null;
  nameStatus: string | null;
  requestedProjectCode: string | null;
  requestedProjectName: string | null;
  createdAtLabel: string;
};

const actionBase =
  "inline-flex w-full min-h-14 items-center justify-center rounded-xl px-3 py-2.5 text-center text-sm font-medium leading-snug transition-all duration-200 ease-out sm:min-h-12 sm:px-5 sm:py-3 sm:text-base";

export function CustomerCreatedClient({ summary }: { summary: CustomerCreatedSummary }) {
  const { t, locale } = useTranslation();
  const detailHref = `/customers/${summary.customerId}`;
  const followUpHref = `/customers/${summary.customerId}/follow-ups/new`;

  const displayName = getCustomerDisplayName({
    customerName: summary.customerName,
    nameStatus: summary.nameStatus,
    locale,
  });
  const projectLabel = resolveRequestedProjectDisplayName({
    requestedProjectCode: summary.requestedProjectCode,
    requestedProjectName: summary.requestedProjectName,
    locale,
  }).trim();

  return (
    <div className="mx-auto w-full max-w-3xl max-md:pb-[env(safe-area-inset-bottom,0px)]">
      <div className="surface-card px-4 py-5 sm:px-8 sm:py-10">
        <div className="flex flex-col items-center text-center">
          <div
            className={cn(
              "flex h-12 w-12 items-center justify-center rounded-full",
              "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200/80",
              "dark:bg-emerald-950/50 dark:text-emerald-300 dark:ring-emerald-800/60",
            )}
            aria-hidden
          >
            <Check className="h-6 w-6" strokeWidth={2} />
          </div>
          <h1 className="page-title mt-4">{t("customers.createdTitle")}</h1>
          <p className="page-description mt-2 max-w-md">
            {t("customers.createdSubtitle")}
          </p>
        </div>

        <dl
          className={cn(
            "mt-4 space-y-2.5 rounded-xl border border-[var(--color-crm-border-subtle)]",
            "bg-[var(--color-crm-surface-muted,transparent)] p-3",
            "sm:mt-8 sm:grid sm:grid-cols-2 sm:gap-x-6 sm:gap-y-5 sm:space-y-0 sm:p-5",
          )}
        >
          <div className="flex min-w-0 items-baseline justify-between gap-3 sm:block sm:text-left">
            <dt className="customer-detail-label shrink-0">
              {t("customers.createdCustomerName")}
            </dt>
            <dd className="customer-detail-strong-value min-w-0 break-words text-right sm:mt-1 sm:text-left">
              {displayName}
            </dd>
          </div>
          <div className="flex min-w-0 items-baseline justify-between gap-3 sm:col-span-2 sm:order-3 sm:block sm:text-left">
            <dt className="customer-detail-label shrink-0">
              {t("customers.createdRequestedProject")}
            </dt>
            <dd className="customer-detail-value min-w-0 break-words text-right sm:mt-1 sm:text-left">
              {projectLabel || t("customers.createdNotProvided")}
            </dd>
          </div>
          <div className="flex min-w-0 items-baseline justify-between gap-3 sm:order-2 sm:block sm:text-left">
            <dt className="customer-detail-label shrink-0">
              {t("customers.createdAt")}
            </dt>
            <dd className="customer-detail-value min-w-0 break-words text-right sm:mt-1 sm:text-left">
              {summary.createdAtLabel}
            </dd>
          </div>
        </dl>

        <div
          className="mt-4 grid grid-cols-2 gap-2.5 sm:mt-8 sm:gap-3"
          role="navigation"
          aria-label={t("customers.createdActionsLabel")}
        >
          <Link
            href={detailHref}
            className={cn(actionBase, "primary-button text-white hover:-translate-y-px")}
          >
            {t("customers.createdViewDetails")}
          </Link>
          <Link
            href={followUpHref}
            className={cn(actionBase, "secondary-button")}
          >
            {t("customers.createdAddFollowUp")}
          </Link>
          <Link
            href="/customers/new"
            className={cn(actionBase, "secondary-button")}
          >
            {t("customers.createdCreateAnother")}
          </Link>
          <Link href="/customers" className={cn(actionBase, "ghost-button")}>
            {t("customers.createdBackToList")}
          </Link>
        </div>
      </div>
    </div>
  );
}
