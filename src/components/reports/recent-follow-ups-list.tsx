"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/card";
import { useTranslation } from "@/i18n/provider";
import { useCustomerLabels } from "@/i18n/use-customer-labels";
import { formatHongKongDateTime } from "@/lib/timezone";
import type { RecentFollowUpRow } from "@/lib/reports/types";

const linkClass = "text-[#2F6FB3] hover:text-[#1F4E79] hover:underline";

export function RecentFollowUpsList({
  items,
  showStaffName = false,
}: {
  items: RecentFollowUpRow[];
  showStaffName?: boolean;
}) {
  const { t } = useTranslation();
  const { followUpChannel, followUpOutcome } = useCustomerLabels();

  if (items.length === 0) {
    return (
      <p className="text-sm text-[#6B7890]">{t("reports.noRecentFollowUps")}</p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="border-b border-[#E3E8F0] text-left text-[#6B7890]">
            <th className="pb-2.5 pr-3 text-xs font-semibold uppercase tracking-wide">
              {t("reports.columnTime")}
            </th>
            <th className="pb-2.5 pr-3 text-xs font-semibold uppercase tracking-wide">
              {t("reports.columnCustomer")}
            </th>
            {showStaffName && (
              <th className="pb-2.5 pr-3 text-xs font-semibold uppercase tracking-wide">
                {t("dashboard.columnStaff")}
              </th>
            )}
            <th className="pb-2.5 pr-3 text-xs font-semibold uppercase tracking-wide">
              {t("reports.columnChannel")}
            </th>
            <th className="pb-2.5 text-xs font-semibold uppercase tracking-wide">
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
              <td className="py-3 pr-3 whitespace-nowrap text-[#6B7890]">
                {formatHongKongDateTime(item.followUpTime)}
              </td>
              <td className="py-3 pr-3">
                <Link
                  href={`/customers/${item.customerId}`}
                  className={`font-medium ${linkClass}`}
                >
                  {item.customerName}
                </Link>
              </td>
              {showStaffName && (
                <td className="py-3 pr-3 text-[#172033]">{item.userName}</td>
              )}
              <td className="py-3 pr-3">
                <div className="flex flex-wrap gap-1">
                  <Badge>{followUpChannel(item.channel)}</Badge>
                  <Badge variant="accent">
                    {followUpOutcome(item.outcome)}
                  </Badge>
                </div>
              </td>
              <td className="py-3 max-w-xs truncate text-[#172033]">
                {item.summary}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
