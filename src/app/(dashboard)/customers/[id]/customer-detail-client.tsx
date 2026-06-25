"use client";

import Link from "next/link";
import { useCustomerLabels } from "@/i18n/use-customer-labels";
import { ReleaseToPoolButton } from "@/components/customers/release-to-pool-button";
import { CustomerApprovalRequests } from "@/components/customers/customer-approval-requests";
import { CustomerScoresCards } from "@/components/customers/customer-scores-cards";
import { CustomerTimelineView } from "@/components/customers/customer-timeline-view";
import { CustomerAiInsightPanel } from "@/components/customers/customer-ai-insight-panel";
import type { HeatLevel } from "@/lib/customers/scoring/types";
import type { HeatReasonPart } from "@/lib/customers/scoring/heat";
import type { TimelineItem } from "@/lib/customers/timeline/types";

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
  followUps: FollowUpRow[];
  timelineItems: TimelineItem[];
  timelineAccessLevel: "full" | "masked" | "archived_basic";
  showEditButton: boolean;
  showReleaseButton: boolean;
  showFollowUpButton: boolean;
  showApprovalButton: boolean;
};

function DetailRow({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div className="flex py-2 text-sm">
      <dt className="w-32 shrink-0 text-slate-500">{label}</dt>
      <dd className="text-slate-900">{value}</dd>
    </div>
  );
}

export function CustomerDetailClient({
  view,
  followUps,
  timelineItems,
  timelineAccessLevel,
  showEditButton,
  showReleaseButton,
  showFollowUpButton,
  showApprovalButton,
}: Props) {
  const { t, source, salesStage, status, customerType, followUpChannel, followUpOutcome } =
    useCustomerLabels();
  const id = view.id;

  const assignedStaffLabel = !view.ownerId
    ? t("customers.publicPoolOwner")
    : view.ownerName?.trim()
      ? view.ownerName
      : t("customers.unknownStaff");

  const createdByLabel = view.createdByName?.trim()
    ? view.createdByName
    : t("customers.unknownStaff");

  return (
    <div className="max-w-3xl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          {view.customerCode && (
            <p className="font-mono text-sm font-semibold tracking-wide text-indigo-600">
              {view.customerCode}
            </p>
          )}
          <h2 className="text-xl font-semibold text-slate-900">{view.customerName}</h2>
          <div className="mt-1 flex items-center gap-2">
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
              {status(view.status)}
            </span>
            {view.isMasked && !view.isArchived && (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
                {t("customers.publicPoolMasked")}
              </span>
            )}
            {view.isArchived && (
              <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-700">
                {t("customers.archivedBadge")}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3">
          {showApprovalButton && <CustomerApprovalRequests customerId={id} />}
          {showReleaseButton && <ReleaseToPoolButton customerId={id} />}
          {showFollowUpButton && (
            <Link
              href={`/customers/${id}/follow-ups/new`}
              className="rounded-lg border border-indigo-600 px-4 py-2 text-sm font-medium text-indigo-600 hover:bg-indigo-50"
            >
              {t("customers.newFollowUp")}
            </Link>
          )}
          {showEditButton && (
            <Link
              href={`/customers/${id}/edit`}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
            >
              {t("customers.editClient")}
            </Link>
          )}
          <Link
            href="/customers"
            className="text-sm text-slate-500 hover:text-slate-800"
          >
            ← {t("customers.backToList")}
          </Link>
        </div>
      </div>

      {view.isArchived && (
        <div className="mb-4 rounded-lg border border-slate-300 bg-slate-100 p-4 text-sm text-slate-800">
          <p className="font-medium">{t("customers.archivedNoticeTitle")}</p>
          <p className="mt-1">{t("customers.archivedNoticeBody")}</p>
        </div>
      )}

      {view.isMasked && !view.isArchived && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          {t("customers.maskedNotice")}
        </div>
      )}

      <div className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white px-6">
        <div className="py-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            {t("customers.basicInfo")}
          </h3>
          <dl className="mt-2">
            <DetailRow label={t("customers.clientName")} value={view.customerName} />
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
        </div>

        {!view.isMasked && (
          <div className="py-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              {t("customers.contactInfo")}
            </h3>
            <dl className="mt-2">
              <DetailRow
                label={t("customers.phone")}
                value={
                  view.phone
                    ? `${view.phoneCountryCode ?? ""} ${view.phone}`.trim()
                    : undefined
                }
              />
              <DetailRow label={t("customers.wechatId")} value={view.wechatId} />
              <DetailRow label={t("customers.email")} value={view.email} />
            </dl>
          </div>
        )}

        {!view.isMasked && (view.sourceRemark || view.notes) && (
          <div className="py-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              {t("customers.notes")}
            </h3>
            <dl className="mt-2">
              <DetailRow label={t("customers.sourceRemark")} value={view.sourceRemark} />
              <DetailRow label={t("customers.otherNotes")} value={view.notes} />
            </dl>
          </div>
        )}

        <div className="py-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            {t("customers.systemInfo")}
          </h3>
          <dl className="mt-2">
            <DetailRow
              label={t("customers.assignedStaff")}
              value={assignedStaffLabel}
            />
            <DetailRow label={t("customers.createdBy")} value={createdByLabel} />
            <DetailRow
              label={t("customers.lastFollowUp")}
              value={
                view.lastFollowUpAt
                  ? view.lastFollowUpAt.slice(0, 16).replace("T", " ")
                  : undefined
              }
            />
            <DetailRow
              label={t("customers.lastValidFollowUp")}
              value={
                view.lastValidFollowUpAt
                  ? view.lastValidFollowUpAt.slice(0, 16).replace("T", " ")
                  : view.neverContacted
                    ? t("customers.neverValidFollowUp")
                    : undefined
              }
            />
            <DetailRow
              label={t("customers.nextFollowUp")}
              value={
                view.nextFollowUpAt
                  ? `${view.nextFollowUpAt.slice(0, 16).replace("T", " ")}${view.overdueFollowUp ? t("customers.overdueSuffix") : ""}`
                  : undefined
              }
            />
            <DetailRow
              label={t("customers.createdAt")}
              value={view.createdAt.slice(0, 16).replace("T", " ")}
            />
            <DetailRow
              label={t("customers.updatedAt")}
              value={view.updatedAt.slice(0, 16).replace("T", " ")}
            />
          </dl>
        </div>
      </div>

      {followUps.length > 0 && (
        <div className="mt-6">
          <h3 className="mb-3 text-base font-semibold text-slate-900">
            {t("customers.followUpRecords")}
          </h3>
          <div className="space-y-3">
            {followUps.map((fu) => (
              <div
                key={fu.id}
                className="rounded-lg border border-slate-200 bg-white p-4"
              >
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="font-medium text-slate-700">
                    {fu.followUpTime.slice(0, 16).replace("T", " ")}
                  </span>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">
                    {followUpChannel(fu.channel)}
                  </span>
                  <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-indigo-700">
                    {followUpOutcome(fu.outcome)}
                  </span>
                  {fu.isValidFollowUp === 1 ? (
                    <span className="rounded-full bg-green-100 px-2 py-0.5 text-green-700">
                      {t("customers.validFollowUp")}
                    </span>
                  ) : (
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-500">
                      {t("customers.invalidFollowUp")}
                    </span>
                  )}
                </div>
                <p className="mt-2 text-sm text-slate-800">{fu.summary}</p>
                {fu.nextFollowUpAt && (
                  <p className="mt-1 text-xs text-slate-500">
                    {t("customers.nextFollowUpLabel")}
                    {fu.nextFollowUpAt.slice(0, 16).replace("T", " ")}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

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

      <CustomerTimelineView items={timelineItems} accessLevel={timelineAccessLevel} />
    </div>
  );
}
