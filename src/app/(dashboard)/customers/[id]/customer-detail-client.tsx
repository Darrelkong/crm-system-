"use client";

import { useState } from "react";
import Link from "next/link";
import { Eye, EyeOff } from "lucide-react";
import { useCustomerLabels } from "@/i18n/use-customer-labels";
import { useTranslation } from "@/i18n/provider";
import type { Locale } from "@/i18n/config";
import {
  resolveAssigneeStaffForDetail,
  type AssigneeDisplayLocale,
} from "@/lib/customers/assignee-display";
import { ReleaseToPoolButton } from "@/components/customers/release-to-pool-button";
import { ManageAssigneesButton } from "@/components/customers/manage-assignees-modal";
import { RequestAssigneesButton } from "@/components/customers/request-assignees-modal";
import { CustomerApprovalRequests } from "@/components/customers/customer-approval-requests";
import { CustomerScoresCards } from "@/components/customers/customer-scores-cards";
import { CustomerTimelineView } from "@/components/customers/customer-timeline-view";
import { CustomerAiInsightPanel } from "@/components/customers/customer-ai-insight-panel";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/card";
import { PinnedBadge } from "@/components/customers/pinned-badge";
import type { HeatLevel } from "@/lib/customers/scoring/types";
import type { HeatReasonPart } from "@/lib/customers/scoring/heat";
import type { TimelineItem } from "@/lib/customers/timeline/types";
import { formatHongKongDateTime } from "@/lib/timezone";

type FollowUpRow = {
  id: string;
  followUpTime: string;
  channel: string;
  outcome: string;
  isValidFollowUp: number;
  summary: string;
  nextFollowUpAt: string | null;
};

export type CustomerDetailView = {
  id: string;
  customerCode?: string | null;
  customerName: string;
  customerType: string;
  salesStage: string;
  source: string;
  status: string;
  isMasked: boolean;
  isArchived: boolean;
  isPinned: boolean;
  accessLevel: string;
  phone?: string | null;
  phoneCountryCode?: string | null;
  wechatId?: string | null;
  email?: string | null;
  sourceRemark?: string | null;
  requestedProjectName?: string | null;
  notes?: string | null;
  ownerId?: string | null;
  ownerName?: string | null;
  assigneeNames?: string[];
  createdByName?: string | null;
  lastFollowUpAt?: string | null;
  lastValidFollowUpAt?: string | null;
  neverContacted: boolean;
  nextFollowUpAt?: string | null;
  overdueFollowUp: boolean;
  createdAt: string;
  updatedAt: string;
  heatLevel: HeatLevel;
  completenessScore: number;
  heatReasonKeys?: HeatReasonPart[];
  completenessMissingFields?: string[];
};

type Props = {
  view: CustomerDetailView;
  isAdmin: boolean;
  followUps: FollowUpRow[];
  timelineItems: TimelineItem[];
  timelineAccessLevel: "full" | "masked" | "archived_basic";
  showEditButton: boolean;
  showReleaseButton: boolean;
  showFollowUpButton: boolean;
  showApprovalButton: boolean;
  showManageAssigneesButton: boolean;
  showRequestAssigneesButton: boolean;
};

function DetailRow({
  label,
  value,
  action,
}: {
  label: string;
  value?: string | null;
  action?: React.ReactNode;
}) {
  if (!value && !action) return null;
  return (
    <div className="flex flex-col gap-0.5 py-2.5 text-sm sm:flex-row sm:gap-4">
      <dt className="shrink-0 text-[#6B7890] sm:w-36">{label}</dt>
      <dd className="flex flex-wrap items-center gap-2 text-[#172033]">
        {value ? <span>{value}</span> : null}
        {action}
      </dd>
    </div>
  );
}

const CONTACT_MASK = "********";

function MaskedContactDetailRow({
  label,
  value,
  showLabel,
  hideLabel,
}: {
  label: string;
  value?: string | null;
  showLabel: string;
  hideLabel: string;
}) {
  const [visible, setVisible] = useState(false);
  const trimmed = value?.trim();
  if (!trimmed) return null;

  return (
    <div className="flex flex-col gap-0.5 py-2.5 text-sm sm:flex-row sm:gap-4">
      <dt className="shrink-0 text-[#6B7890] sm:w-36">{label}</dt>
      <dd className="flex flex-wrap items-center gap-2 text-[#172033]">
        <span>{visible ? trimmed : CONTACT_MASK}</span>
        <button
          type="button"
          onClick={() => setVisible((prev) => !prev)}
          className="inline-flex items-center justify-center rounded-md p-1 text-[#6B7890] transition-colors hover:bg-[#EEF2F7] hover:text-[#172033] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2563EB]"
          aria-label={visible ? hideLabel : showLabel}
        >
          {visible ? (
            <EyeOff className="h-4 w-4" aria-hidden="true" />
          ) : (
            <Eye className="h-4 w-4" aria-hidden="true" />
          )}
        </button>
      </dd>
    </div>
  );
}

function SectionCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="surface-card p-5 sm:p-6">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-[#6B7890]">
        {title}
      </h3>
      <div className="mt-3">{children}</div>
    </section>
  );
}

export function CustomerDetailClient({
  view,
  isAdmin,
  followUps,
  timelineItems,
  timelineAccessLevel,
  showEditButton,
  showReleaseButton,
  showFollowUpButton,
  showApprovalButton,
  showManageAssigneesButton,
  showRequestAssigneesButton,
}: Props) {
  const { t, source, salesStage, status, customerType, followUpChannel, followUpOutcome } =
    useCustomerLabels();
  const { locale } = useTranslation();
  const id = view.id;

  function assigneeDisplayLocale(currentLocale: Locale): AssigneeDisplayLocale {
    return currentLocale === "en" ? "en" : "zh";
  }

  const assignedStaffLabel = resolveAssigneeStaffForDetail(
    {
      status: view.status,
      ownerId: view.ownerId ?? null,
      ownerName: view.ownerName ?? null,
      assigneeNames: view.assigneeNames ?? [],
    },
    {
      publicPool: t("customers.publicPoolOwner"),
      unknownStaff: t("customers.unknownStaff"),
    },
    assigneeDisplayLocale(locale),
  );

  const createdByLabel = view.createdByName?.trim()
    ? view.createdByName
    : t("customers.unknownStaff");

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="page-title text-2xl sm:text-3xl">{view.customerName}</h2>
            {view.isPinned && <PinnedBadge className="mt-1" />}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge>{status(view.status)}</Badge>
            {view.isMasked && !view.isArchived && (
              <Badge variant="warning">{t("customers.publicPoolMasked")}</Badge>
            )}
            {view.isArchived && (
              <Badge>{t("customers.archivedBadge")}</Badge>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {showApprovalButton && <CustomerApprovalRequests customerId={id} />}
          {showReleaseButton && <ReleaseToPoolButton customerId={id} />}
          {showFollowUpButton && (
            <Link href={`/customers/${id}/follow-ups/new`}>
              <Button variant="secondary" size="md">
                {t("customers.newFollowUp")}
              </Button>
            </Link>
          )}
          {showEditButton && (
            <Link href={`/customers/${id}/edit`}>
              <Button size="md">{t("customers.editClient")}</Button>
            </Link>
          )}
          <Link
            href="/customers"
            className="px-3 py-2 text-sm text-[#6B7890] hover:text-[#172033]"
          >
            ← {t("customers.backToList")}
          </Link>
        </div>
      </div>

      {view.isArchived && (
        <div className="surface-muted mb-4 p-4 text-sm text-[#172033]">
          <p className="font-medium">{t("customers.archivedNoticeTitle")}</p>
          <p className="mt-1">{t("customers.archivedNoticeBody")}</p>
        </div>
      )}

      {view.isMasked && !view.isArchived && (
        <div className="alert-warning mb-4 px-4 py-3 text-sm">
          {t("customers.maskedNotice")}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3 lg:gap-6">
        <div className="space-y-4 lg:col-span-2 lg:space-y-6">
          <SectionCard title={t("customers.basicInfo")}>
            <dl>
              <DetailRow label={t("customers.clientName")} value={view.customerName} />
              {isAdmin && view.customerCode && (
                <DetailRow
                  label={t("customers.uniqueIdentifier")}
                  value={view.customerCode}
                />
              )}
              <DetailRow
                label={t("customers.clientType")}
                value={customerType(view.customerType)}
              />
              <DetailRow
                label={t("customers.salesStage")}
                value={salesStage(view.salesStage)}
              />
              <DetailRow label={t("customers.source")} value={source(view.source)} />
              {!view.isMasked && (
                <DetailRow
                  label={t("customers.requestedProjectName")}
                  value={view.requestedProjectName}
                />
              )}
            </dl>
          </SectionCard>

          {!view.isMasked && (
            <SectionCard title={t("customers.contactInfo")}>
              <dl>
                <MaskedContactDetailRow
                  label={t("customers.phone")}
                  value={
                    view.phone
                      ? `${view.phoneCountryCode ?? ""} ${view.phone}`.trim()
                      : undefined
                  }
                  showLabel={t("customers.showPhone")}
                  hideLabel={t("customers.hidePhone")}
                />
                <MaskedContactDetailRow
                  label={t("customers.wechatId")}
                  value={view.wechatId}
                  showLabel={t("customers.showWechat")}
                  hideLabel={t("customers.hideWechat")}
                />
                <MaskedContactDetailRow
                  label={t("customers.email")}
                  value={view.email}
                  showLabel={t("customers.showEmail")}
                  hideLabel={t("customers.hideEmail")}
                />
              </dl>
            </SectionCard>
          )}

          {!view.isMasked && (view.sourceRemark || view.notes) && (
            <SectionCard title={t("customers.notes")}>
              <dl>
                <DetailRow label={t("customers.sourceRemark")} value={view.sourceRemark} />
                <DetailRow label={t("customers.stageNotes")} value={view.notes} />
              </dl>
            </SectionCard>
          )}

          {followUps.length > 0 && (
            <section>
              <h3 className="mb-3 text-base font-semibold text-[#172033]">
                {t("customers.followUpRecords")}
              </h3>
              <div className="space-y-3">
                {followUps.map((fu) => (
                  <div key={fu.id} className="surface-card p-4">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="font-medium text-[#172033]">
                        {formatHongKongDateTime(fu.followUpTime)}
                      </span>
                      <Badge>{followUpChannel(fu.channel)}</Badge>
                      <Badge variant="accent">{followUpOutcome(fu.outcome)}</Badge>
                      {fu.isValidFollowUp === 1 ? (
                        <Badge variant="success">{t("customers.validFollowUp")}</Badge>
                      ) : (
                        <Badge>{t("customers.invalidFollowUp")}</Badge>
                      )}
                    </div>
                    <p className="mt-2 text-sm leading-relaxed text-[#172033]">{fu.summary}</p>
                    {fu.nextFollowUpAt && (
                      <p className="mt-1 text-xs text-[#6B7890]">
                        {t("customers.nextFollowUpLabel")}
                        {formatHongKongDateTime(fu.nextFollowUpAt)}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          <CustomerTimelineView items={timelineItems} accessLevel={timelineAccessLevel} />
        </div>

        <div className="space-y-4 lg:space-y-6">
          <SectionCard title={t("customers.systemInfo")}>
            <dl>
              <DetailRow
                label={t("customers.assignedStaff")}
                value={assignedStaffLabel}
                action={
                  showManageAssigneesButton ? (
                    <ManageAssigneesButton customerId={id} />
                  ) : showRequestAssigneesButton ? (
                    <RequestAssigneesButton customerId={id} />
                  ) : undefined
                }
              />
              <DetailRow label={t("customers.createdBy")} value={createdByLabel} />
              <DetailRow
                label={t("customers.lastFollowUp")}
                value={
                  view.lastFollowUpAt
                    ? formatHongKongDateTime(view.lastFollowUpAt)
                    : undefined
                }
              />
              <DetailRow
                label={t("customers.lastValidFollowUp")}
                value={
                  view.lastValidFollowUpAt
                    ? formatHongKongDateTime(view.lastValidFollowUpAt)
                    : view.neverContacted
                      ? t("customers.neverValidFollowUp")
                      : undefined
                }
              />
              <DetailRow
                label={t("customers.nextFollowUp")}
                value={
                  view.nextFollowUpAt
                    ? `${formatHongKongDateTime(view.nextFollowUpAt)}${view.overdueFollowUp ? t("customers.overdueSuffix") : ""}`
                    : undefined
                }
              />
              <DetailRow
                label={t("customers.createdAt")}
                value={formatHongKongDateTime(view.createdAt)}
              />
              <DetailRow
                label={t("customers.updatedAt")}
                value={formatHongKongDateTime(view.updatedAt)}
              />
            </dl>
          </SectionCard>

          <CustomerScoresCards
            scores={{
              heatLevel: view.heatLevel,
              completenessScore: view.completenessScore,
              heatReasonKeys: view.heatReasonKeys,
              completenessMissingFields: view.completenessMissingFields,
              accessLevel: view.accessLevel as "full" | "masked" | "archived_basic",
            }}
            showMissingFields={view.accessLevel === "full"}
          />

          <CustomerAiInsightPanel key={id} customerId={id} />
        </div>
      </div>
    </div>
  );
}
