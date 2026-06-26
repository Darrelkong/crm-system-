"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Badge, Card, EmptyState } from "@/components/ui/card";
import { Field, Input, Label, Select } from "@/components/ui/form";
import { PageIntro } from "@/components/ui/page-intro";
import { useTranslation } from "@/i18n/provider";
import { useCustomerLabels } from "@/i18n/use-customer-labels";
import type { FollowUpListItem } from "@/lib/follow-ups/types";
import { formatHongKongDate, formatHongKongDateTime } from "@/lib/timezone";

const linkClass = "text-[#2F6FB3] hover:text-[#1F4E79] hover:underline";

type Filters = {
  search: string;
  staffUserId: string;
  channel: string;
  fromDate: string;
  toDate: string;
};

function applyFilters(items: FollowUpListItem[], filters: Filters): FollowUpListItem[] {
  const search = filters.search.trim().toLowerCase();

  return items.filter((item) => {
    if (search && !item.customerName.toLowerCase().includes(search)) {
      return false;
    }
    if (filters.staffUserId && item.userId !== filters.staffUserId) {
      return false;
    }
    if (filters.channel && item.channel !== filters.channel) {
      return false;
    }
    if (filters.fromDate) {
      const itemDate = formatHongKongDate(item.followUpTime, "");
      if (!itemDate || itemDate < filters.fromDate) {
        return false;
      }
    }
    if (filters.toDate) {
      const itemDate = formatHongKongDate(item.followUpTime, "");
      if (!itemDate || itemDate > filters.toDate) {
        return false;
      }
    }
    return true;
  });
}

function FollowUpRowContent({
  item,
  showStaff,
  followUpChannel,
  followUpOutcome,
  salesStage,
  status,
  t,
}: {
  item: FollowUpListItem;
  showStaff: boolean;
  followUpChannel: (key: string) => string;
  followUpOutcome: (key: string) => string;
  salesStage: (key: string) => string;
  status: (key: string) => string;
  t: (key: string) => string;
}) {
  return (
    <>
      <div className="flex flex-wrap items-center gap-2 text-xs text-[#6B7890]">
        <span className="font-medium text-[#172033]">
          {formatHongKongDateTime(item.followUpTime)}
        </span>
        {showStaff && (
          <span>
            {t("followUpsPage.staff")}: {item.userName}
          </span>
        )}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Link href={`/customers/${item.customerId}`} className={`text-sm font-medium ${linkClass}`}>
          {item.customerName}
        </Link>
        <Badge>{salesStage(item.customerSalesStage)}</Badge>
        <Badge variant="accent">{status(item.customerStatus)}</Badge>
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        <Badge>{followUpChannel(item.channel)}</Badge>
        <Badge variant="accent">{followUpOutcome(item.outcome)}</Badge>
        {item.isValidFollowUp ? (
          <Badge variant="success">{t("customers.validFollowUp")}</Badge>
        ) : (
          <Badge>{t("customers.invalidFollowUp")}</Badge>
        )}
      </div>
      <p className="mt-2 text-sm leading-relaxed text-[#172033]">{item.summary}</p>
      {(item.nextAction || item.nextFollowUpAt) && (
        <p className="mt-2 text-xs text-[#6B7890]">
          {t("followUpsPage.nextStep")}
          {item.nextAction ? `: ${item.nextAction}` : ""}
          {item.nextFollowUpAt
            ? ` (${formatHongKongDateTime(item.nextFollowUpAt)})`
            : ""}
        </p>
      )}
      <Link
        href={`/customers/${item.customerId}`}
        className={`mt-3 inline-block text-xs ${linkClass}`}
      >
        {t("followUpsPage.viewCustomer")}
      </Link>
    </>
  );
}

export function FollowUpsListClient({
  items,
  role,
}: {
  items: FollowUpListItem[];
  role: "admin" | "staff";
}) {
  const { t } = useTranslation();
  const { followUpChannel, followUpOutcome, salesStage, status } =
    useCustomerLabels();
  const showStaff = role === "admin";

  const [filters, setFilters] = useState<Filters>({
    search: "",
    staffUserId: "",
    channel: "",
    fromDate: "",
    toDate: "",
  });

  const staffOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of items) {
      map.set(item.userId, item.userName);
    }
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [items]);

  const channelOptions = useMemo(() => {
    const set = new Set(items.map((item) => item.channel));
    return [...set].sort();
  }, [items]);

  const filteredItems = useMemo(
    () => applyFilters(items, filters),
    [items, filters],
  );

  return (
    <div className="space-y-6">
      <PageIntro
        title={t("followUpsPage.title")}
        description={
          role === "admin"
            ? t("followUpsPage.adminDescription")
            : t("followUpsPage.staffDescription")
        }
      />

      <Card className="p-4 sm:p-5">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          <div className="sm:col-span-2 lg:col-span-1 xl:col-span-2">
            <Label htmlFor="follow-up-search">{t("followUpsPage.searchCustomer")}</Label>
            <Input
              id="follow-up-search"
              value={filters.search}
              onChange={(e) =>
                setFilters((prev) => ({ ...prev, search: e.target.value }))
              }
              placeholder={t("followUpsPage.searchCustomerPlaceholder")}
            />
          </div>
          <Field>
            <Label htmlFor="follow-up-from">{t("followUpsPage.fromDate")}</Label>
            <Input
              id="follow-up-from"
              type="date"
              value={filters.fromDate}
              onChange={(e) =>
                setFilters((prev) => ({ ...prev, fromDate: e.target.value }))
              }
            />
          </Field>
          <Field>
            <Label htmlFor="follow-up-to">{t("followUpsPage.toDate")}</Label>
            <Input
              id="follow-up-to"
              type="date"
              value={filters.toDate}
              onChange={(e) =>
                setFilters((prev) => ({ ...prev, toDate: e.target.value }))
              }
            />
          </Field>
          <Field>
            <Label htmlFor="follow-up-channel">{t("followUpsPage.channelFilter")}</Label>
            <Select
              id="follow-up-channel"
              value={filters.channel}
              onChange={(e) =>
                setFilters((prev) => ({ ...prev, channel: e.target.value }))
              }
            >
              <option value="">{t("followUpsPage.allChannels")}</option>
              {channelOptions.map((channel) => (
                <option key={channel} value={channel}>
                  {followUpChannel(channel)}
                </option>
              ))}
            </Select>
          </Field>
          {showStaff && (
            <Field>
              <Label htmlFor="follow-up-staff">{t("followUpsPage.staffFilter")}</Label>
              <Select
                id="follow-up-staff"
                value={filters.staffUserId}
                onChange={(e) =>
                  setFilters((prev) => ({ ...prev, staffUserId: e.target.value }))
                }
              >
                <option value="">{t("followUpsPage.allStaff")}</option>
                {staffOptions.map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
        </div>
      </Card>

      {filteredItems.length === 0 ? (
        <EmptyState
          message={t("followUpsPage.empty")}
          action={
            <Link href="/customers" className="link-primary text-sm">
              {t("nav.customers")}
            </Link>
          }
        />
      ) : (
        <>
          <div className="space-y-3 md:hidden">
            {filteredItems.map((item) => (
              <Card key={item.id} className="p-4">
                <FollowUpRowContent
                  item={item}
                  showStaff={showStaff}
                  followUpChannel={followUpChannel}
                  followUpOutcome={followUpOutcome}
                  salesStage={salesStage}
                  status={status}
                  t={t}
                />
              </Card>
            ))}
          </div>

          <Card className="hidden overflow-x-auto p-0 md:block">
            <table className="w-full min-w-[960px] text-sm">
              <thead>
                <tr className="border-b border-[#E3E8F0] text-left text-[#6B7890]">
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide">
                    {t("followUpsPage.time")}
                  </th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide">
                    {t("followUpsPage.customer")}
                  </th>
                  {showStaff && (
                    <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide">
                      {t("followUpsPage.staff")}
                    </th>
                  )}
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide">
                    {t("followUpsPage.channel")}
                  </th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide">
                    {t("followUpsPage.content")}
                  </th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide">
                    {t("followUpsPage.nextStep")}
                  </th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide">
                    {t("followUpsPage.stageStatus")}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#EEF3F8]">
                {filteredItems.map((item) => (
                  <tr
                    key={item.id}
                    className="table-row transition-colors duration-200 hover:bg-[#E8F1FA]"
                  >
                    <td className="px-4 py-3 whitespace-nowrap text-[#6B7890]">
                      {formatHongKongDateTime(item.followUpTime)}
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/customers/${item.customerId}`}
                        className={`font-medium ${linkClass}`}
                      >
                        {item.customerName}
                      </Link>
                    </td>
                    {showStaff && (
                      <td className="px-4 py-3 text-[#172033]">{item.userName}</td>
                    )}
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        <Badge>{followUpChannel(item.channel)}</Badge>
                        <Badge variant="accent">
                          {followUpOutcome(item.outcome)}
                        </Badge>
                      </div>
                    </td>
                    <td className="max-w-xs px-4 py-3 text-[#172033]">
                      <p className="line-clamp-2">{item.summary}</p>
                    </td>
                    <td className="max-w-xs px-4 py-3 text-[#6B7890]">
                      {item.nextAction ?? "—"}
                      {item.nextFollowUpAt && (
                        <p className="mt-1 text-xs">
                          {formatHongKongDateTime(item.nextFollowUpAt)}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        <Badge>{salesStage(item.customerSalesStage)}</Badge>
                        <Badge variant="accent">{status(item.customerStatus)}</Badge>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </div>
  );
}
