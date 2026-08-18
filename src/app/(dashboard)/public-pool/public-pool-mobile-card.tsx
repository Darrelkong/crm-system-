"use client";

import Link from "next/link";
import { CompletenessBadge } from "@/components/customers/customer-scores-cards";
import { CustomerNameLabel } from "@/components/customers/customer-name-label";
import { Button } from "@/components/ui/button";
import type { Locale } from "@/i18n/config";
import { getSalesStageBadgeClass } from "@/lib/customers/sales-stage-badges";
import { formatPublicPoolAdminContact } from "@/lib/public-pool/display";
import {
  displayPublicPoolReason,
  type AdminPublicPoolCustomerView,
} from "@/lib/public-pool/queries";
import { ui } from "@/lib/ui/classes";
import { PublicPoolReasonDisplay } from "./public-pool-reason-display";

type InfoRowProps = {
  label: string;
  value: string;
};

function InfoRow({ label, value }: InfoRowProps) {
  return (
    <div className="flex items-start justify-between gap-3 text-sm">
      <span className={`shrink-0 ${ui.textSecondary}`}>{label}</span>
      <span
        className={`min-w-0 text-right tabular-nums ${ui.textPrimary} [overflow-wrap:anywhere]`}
      >
        {value}
      </span>
    </div>
  );
}

type ContactRowProps = {
  label: string;
  value: string;
};

function ContactRow({ label, value }: ContactRowProps) {
  return (
    <div className="flex items-start justify-between gap-3 text-sm">
      <span className={`shrink-0 ${ui.textSecondary}`}>{label}</span>
      <span className={`min-w-0 text-right break-all ${ui.textPrimary}`}>
        {value}
      </span>
    </div>
  );
}

export function PublicPoolMobileCard({
  customer,
  locale,
  customerTypeLabel,
  sourceLabel,
  salesStageLabel,
  lastValidFollowUpLabel,
  lastValidFollowUpValue,
  lastFollowUpLabel,
  lastFollowUpValue,
  poolEnteredAtLabel,
  poolEnteredAtValue,
  poolReasonLabel,
  previousOwnerLabel,
  previousOwnerUnknownLabel,
  phoneLabel,
  wechatLabel,
  emailLabel,
  pendingNameLabel,
  viewLabel,
  claimLabel,
  claimingLabel,
  claiming,
  canClaim,
  blockReason,
  onClaim,
}: {
  customer: AdminPublicPoolCustomerView;
  locale: Locale;
  pendingNameLabel: string;
  customerTypeLabel: string;
  sourceLabel: string;
  salesStageLabel: string;
  lastValidFollowUpLabel: string;
  lastValidFollowUpValue: string;
  lastFollowUpLabel: string;
  lastFollowUpValue: string;
  poolEnteredAtLabel: string;
  poolEnteredAtValue: string;
  poolReasonLabel: string;
  previousOwnerLabel: string;
  previousOwnerUnknownLabel: string;
  phoneLabel: string;
  wechatLabel: string;
  emailLabel: string;
  viewLabel: string;
  claimLabel: string;
  claimingLabel: string;
  claiming: boolean;
  canClaim: boolean;
  blockReason: string | null;
  onClaim: () => void;
}) {
  const poolReason = displayPublicPoolReason(customer);
  const contact = formatPublicPoolAdminContact(customer);
  const hasWechat = Boolean(contact.wechatId);
  const hasEmail = Boolean(contact.email);
  const showPhone = contact.phone !== "—";

  return (
    <article className="surface-card overflow-hidden p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <CustomerNameLabel
            customerName={customer.customerName || customer.maskedName}
            nameStatus={customer.nameStatus}
            locale={locale}
            pendingLabel={pendingNameLabel}
            nameClassName={`font-semibold [overflow-wrap:anywhere] ${ui.textPrimary}`}
            renderName={(displayName) => (
              <Link
                href={`/customers/${customer.id}`}
                className="link-primary font-semibold hover:underline [overflow-wrap:anywhere]"
              >
                {displayName}
              </Link>
            )}
          />
          <p
            className={`mt-1 text-xs ${ui.textSecondary} [overflow-wrap:anywhere]`}
          >
            {customerTypeLabel} · {sourceLabel}
          </p>
          <span
            className={`mt-2 inline-flex shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${getSalesStageBadgeClass(customer.salesStage)}`}
          >
            {salesStageLabel}
          </span>
        </div>
        <div className="shrink-0">
          <CompletenessBadge score={customer.completenessScore} />
        </div>
      </div>

      <div className="mt-4 space-y-2 border-t crm-border pt-4">
        <InfoRow label={lastValidFollowUpLabel} value={lastValidFollowUpValue} />
        <InfoRow label={lastFollowUpLabel} value={lastFollowUpValue} />
        <InfoRow label={poolEnteredAtLabel} value={poolEnteredAtValue} />
      </div>

      {(poolReason || customer.previousOwnerDisplayName !== undefined) && (
        <div className="mt-4 border-t crm-border pt-4">
          <p className={`text-xs font-medium ${ui.textSecondary}`}>
            {poolReasonLabel}
          </p>
          <div className="mt-1">
            <PublicPoolReasonDisplay
              poolReason={poolReason}
              previousOwnerDisplayName={customer.previousOwnerDisplayName}
              previousOwnerLabel={previousOwnerLabel}
              previousOwnerUnknownLabel={previousOwnerUnknownLabel}
            />
          </div>
        </div>
      )}

      {(showPhone || hasWechat || hasEmail) && (
        <div className="mt-4 space-y-2 border-t crm-border pt-4">
          {showPhone && (
            <ContactRow label={phoneLabel} value={contact.phone} />
          )}
          {hasWechat && contact.wechatId && (
            <ContactRow label={wechatLabel} value={contact.wechatId} />
          )}
          {hasEmail && contact.email && (
            <ContactRow label={emailLabel} value={contact.email} />
          )}
        </div>
      )}

      <div className="mt-4 flex flex-col gap-2 border-t crm-border pt-4 sm:flex-row">
        <Link href={`/customers/${customer.id}`} className="sm:flex-1">
          <Button type="button" variant="secondary" className="w-full">
            {viewLabel}
          </Button>
        </Link>
        <Button
          type="button"
          className="w-full sm:flex-1"
          disabled={!canClaim || claiming}
          onClick={onClaim}
          title={blockReason ?? undefined}
        >
          {claiming ? claimingLabel : claimLabel}
        </Button>
      </div>
      {!canClaim && blockReason && (
        <p className="mt-2 text-xs text-red-600">{blockReason}</p>
      )}
    </article>
  );
}
