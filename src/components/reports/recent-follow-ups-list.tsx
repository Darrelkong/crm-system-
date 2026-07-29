"use client";

import Link from "next/link";
import { CustomerNameLabel } from "@/components/customers/customer-name-label";
import { Badge } from "@/components/ui/card";
import { useTranslation } from "@/i18n/provider";
import { useCustomerLabels } from "@/i18n/use-customer-labels";
import { formatHongKongDateTime } from "@/lib/timezone";
import type { RecentFollowUpRow } from "@/lib/reports/types";

const linkClass = "text-[#2F6FB3] hover:text-[#1F4E79] hover:underline";

function CustomerLink({
  item,
  locale,
  pendingLabel,
}: {
  item: RecentFollowUpRow;
  locale: string;
  pendingLabel: string;
}) {
  return (
    <CustomerNameLabel
      customerName={item.customerName}
      nameStatus={item.nameStatus}
      locale={locale}
      pendingLabel={pendingLabel}
      renderName={(displayName) => (
        <Link
          href={`/customers/${item.customerId}`}
          className={`font-medium ${linkClass}`}
        >
          {displayName}
        </Link>
      )}
    />
  );
}

function ChannelBadges({
  channel,
  outcome,
  followUpChannel,
  followUpOutcome,
}: {
  channel: string;
  outcome: string;
  followUpChannel: (key: string) => string;
  followUpOutcome: (key: string) => string;
}) {
  return (
    <div className="flex flex-wrap gap-1">
      <Badge>{followUpChannel(channel)}</Badge>
      <Badge variant="accent">{followUpOutcome(outcome)}</Badge>
    </div>
  );
}

export function RecentFollowUpsList({
  items,
  showStaffName = false,
}: {
  items: RecentFollowUpRow[];
  showStaffName?: boolean;
}) {
  const { t, locale } = useTranslation();
  const { followUpChannel, followUpOutcome } = useCustomerLabels();
  const pendingLabel = t("customers.namePendingBadge");

  if (items.length === 0) {
    return (
      <p className="text-sm text-[#6B7890]">{t("reports.noRecentFollowUps")}</p>
    );
  }

  return (
    <>
      {/* Mobile / tablet portrait: card list (no horizontal scroll). */}
      <ul className="space-y-2.5 lg:hidden" data-reports-recent-mobile>
        {items.map((item) => (
          <li key={item.id}>
            <article className="surface-muted rounded-xl px-3.5 py-3">
              <div className="flex min-h-11 flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <CustomerLink
                    item={item}
                    locale={locale}
                    pendingLabel={pendingLabel}
                  />
                </div>
                <ChannelBadges
                  channel={item.channel}
                  outcome={item.outcome}
                  followUpChannel={followUpChannel}
                  followUpOutcome={followUpOutcome}
                />
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[#6B7890]">
                <time className="whitespace-nowrap">
                  {formatHongKongDateTime(item.followUpTime)}
                </time>
                {showStaffName && (
                  <span className="min-w-0 break-words">{item.userName}</span>
                )}
              </div>
              <p className="mt-2 line-clamp-2 text-sm leading-snug text-[#172033]">
                {item.summary}
              </p>
            </article>
          </li>
        ))}
      </ul>

      {/* Desktop / large tablet: table. Hidden below lg (display:none → no tab stops). */}
      <div className="hidden overflow-x-auto lg:block" data-reports-recent-desktop>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[#E3E8F0] text-left text-[#6B7890]">
              <th className="pb-2 pr-3 text-xs font-semibold uppercase tracking-wide whitespace-nowrap">
                {t("reports.columnTime")}
              </th>
              <th className="min-w-[8rem] pb-2 pr-3 text-xs font-semibold uppercase tracking-wide">
                {t("reports.columnCustomer")}
              </th>
              {showStaffName && (
                <th className="min-w-[6rem] pb-2 pr-3 text-xs font-semibold uppercase tracking-wide">
                  {t("dashboard.columnStaff")}
                </th>
              )}
              <th className="pb-2 pr-3 text-xs font-semibold uppercase tracking-wide">
                {t("reports.columnChannel")}
              </th>
              <th className="pb-2 text-xs font-semibold uppercase tracking-wide">
                {t("reports.columnSummary")}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#EEF3F8]">
            {items.map((item) => (
              <tr
                key={item.id}
                className="table-row transition-colors duration-200 hover:bg-[#E8F1FA]"
              >
                <td className="py-2.5 pr-3 whitespace-nowrap text-[#6B7890]">
                  {formatHongKongDateTime(item.followUpTime)}
                </td>
                <td className="min-w-[8rem] py-2.5 pr-3">
                  <CustomerLink
                    item={item}
                    locale={locale}
                    pendingLabel={pendingLabel}
                  />
                </td>
                {showStaffName && (
                  <td className="min-w-[6rem] py-2.5 pr-3 whitespace-nowrap text-[#172033]">
                    {item.userName}
                  </td>
                )}
                <td className="py-2.5 pr-3">
                  <ChannelBadges
                    channel={item.channel}
                    outcome={item.outcome}
                    followUpChannel={followUpChannel}
                    followUpOutcome={followUpOutcome}
                  />
                </td>
                <td className="max-w-xs truncate py-2.5 text-[#172033]">
                  {item.summary}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
