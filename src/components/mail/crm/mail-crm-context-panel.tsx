"use client";

import { ChevronDown } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import { CustomerNameLabel } from "@/components/customers/customer-name-label";
import { Badge } from "@/components/ui/card";
import { cn } from "@/lib/cn";
import { useCustomerLabels } from "@/i18n/use-customer-labels";
import { useTranslation } from "@/i18n/provider";
import {
  formatMailCrmAssociationType,
  hasMailCrmContextAssociation,
  pickMailCrmContextSafeFields,
  resolveMailCrmContextDefaultExpanded,
  type MailCrmContextAssociation,
} from "@/lib/mail/crm/mail-crm-context-model";
import { getSalesStageBadgeClass } from "@/lib/customers/sales-stage-badges";

export type MailCrmContextPanelProps = {
  customerAssociation: MailCrmContextAssociation | null | undefined;
  variant?: "desktop" | "mobile";
  defaultExpanded?: boolean;
};

function ContextField({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="mail-crm-context-field min-w-0">
      <dt className="mail-crm-context-label">{label}</dt>
      <dd className="mail-crm-context-value mt-0.5 text-sm crm-text">{children}</dd>
    </div>
  );
}

export function MailCrmContextPanel({
  customerAssociation,
  variant = "desktop",
  defaultExpanded,
}: MailCrmContextPanelProps) {
  const { t, locale } = useTranslation();
  const { salesStage } = useCustomerLabels();
  const panelId = useId();
  const [expanded, setExpanded] = useState(
    defaultExpanded ?? resolveMailCrmContextDefaultExpanded(variant),
  );

  const hasAssociation = hasMailCrmContextAssociation(customerAssociation);
  const association = hasAssociation
    ? pickMailCrmContextSafeFields(customerAssociation)
    : null;

  return (
    <section
      className={cn(
        "mail-crm-context-panel shrink-0 border-t crm-border",
        variant === "mobile" && "mail-crm-context-panel--mobile",
      )}
      aria-label={t("mail.crmContext.title")}
    >
      <button
        type="button"
        className="mail-crm-context-toggle flex w-full items-center gap-2 px-4 py-3 text-left sm:px-6"
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={() => setExpanded((value) => !value)}
      >
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 crm-text-secondary transition-transform duration-200",
            expanded && "rotate-180",
          )}
          aria-hidden
        />
        <span className="text-sm font-medium crm-text">
          {t("mail.crmContext.title")}
        </span>
      </button>

      {expanded ? (
        <div
          id={panelId}
          className="mail-crm-context-body px-4 pb-4 sm:px-6 sm:pb-5"
        >
          {association ? (
            <dl className="mail-crm-context-card grid gap-3 rounded-xl border crm-border px-3 py-3 sm:grid-cols-2 sm:gap-x-4 sm:px-4">
              <ContextField label={t("mail.crmContext.customer")}>
                <CustomerNameLabel
                  customerName={association.name}
                  nameStatus="confirmed"
                  locale={locale}
                  pendingLabel={t("customers.namePendingBadge")}
                  nameClassName="font-medium"
                />
              </ContextField>
              <ContextField label={t("mail.crmContext.customerCode")}>
                {association.customerCode ?? t("mail.crmContext.notAvailable")}
              </ContextField>
              <ContextField label={t("mail.crmContext.stage")}>
                <Badge
                  className={cn(
                    "inline-flex rounded-full px-2 py-0.5 text-xs font-medium",
                    getSalesStageBadgeClass(association.salesStage),
                  )}
                >
                  {salesStage(association.salesStage)}
                </Badge>
              </ContextField>
              <ContextField label={t("mail.crmContext.owner")}>
                {association.ownerName ?? t("mail.crmContext.notAvailable")}
              </ContextField>
              <ContextField label={t("mail.crmContext.association")}>
                {formatMailCrmAssociationType(association.associationType, {
                  manual: t("mail.crmContext.associationManual"),
                  autoMatch: t("mail.crmContext.associationAutoMatch"),
                })}
              </ContextField>
            </dl>
          ) : (
            <p className="mail-crm-context-empty rounded-xl border border-dashed crm-border px-3 py-3 text-sm crm-text-secondary">
              {t("mail.crmContext.empty")}
            </p>
          )}
        </div>
      ) : null}
    </section>
  );
}
