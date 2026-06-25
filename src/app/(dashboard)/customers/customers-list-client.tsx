"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useCustomerLabels } from "@/i18n/use-customer-labels";
import {
  CompletenessBadge,
  HeatBadge,
} from "@/components/customers/customer-scores-cards";
import type { HeatLevel } from "@/lib/customers/scoring/types";
import { HEAT_LEVELS } from "@/lib/customers/scoring/types";

export type CustomerListRow = {
  id: string;
  customerCode?: string | null;
  customerName: string;
  customerType: string;
  source: string;
  salesStage: string;
  status: string;
  heatLevel: HeatLevel;
  completenessScore: number;
  neverContacted: boolean;
  overdueFollowUp: boolean;
  isArchived: boolean;
  isMasked: boolean;
  createdAt: string;
};

type Props = {
  initialRows: CustomerListRow[];
  showArchived: boolean;
  isAdmin: boolean;
  filterHeat?: string;
  filterCompletenessBelow?: string;
  baseQuery: string;
};

type ApiCustomerItem = CustomerListRow & {
  isArchived?: boolean;
};

function mapApiItem(item: ApiCustomerItem): CustomerListRow {
  return {
    id: item.id,
    customerCode: item.customerCode,
    customerName: item.customerName,
    customerType: item.customerType,
    source: item.source,
    salesStage: item.salesStage,
    status: item.status,
    heatLevel: item.heatLevel,
    completenessScore: item.completenessScore,
    neverContacted: item.neverContacted,
    overdueFollowUp: item.overdueFollowUp,
    isArchived: item.isArchived ?? false,
    isMasked: item.isMasked,
    createdAt: item.createdAt,
  };
}

export function CustomersListClient({
  initialRows,
  showArchived,
  isAdmin,
  filterHeat,
  filterCompletenessBelow,
  baseQuery,
}: Props) {
  const { t, source, salesStage, status, customerType, heatLevel } = useCustomerLabels();
  const [searchQuery, setSearchQuery] = useState("");
  const [rows, setRows] = useState(initialRows);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    setRows(initialRows);
  }, [initialRows]);

  useEffect(() => {
    const q = searchQuery.trim();
    if (!q) {
      setRows(initialRows);
      setSearching(false);
      return;
    }

    const handle = window.setTimeout(async () => {
      setSearching(true);
      try {
        const params = new URLSearchParams({ q });
        if (filterHeat) params.set("heat", filterHeat);
        if (filterCompletenessBelow) {
          params.set("completenessBelow", filterCompletenessBelow);
        }
        if (showArchived) params.set("status", "archived");

        const res = await fetch(`/api/customers?${params.toString()}`);
        const data = (await res.json()) as { items?: ApiCustomerItem[] };
        if (res.ok && data.items) {
          setRows(data.items.map(mapApiItem));
        }
      } finally {
        setSearching(false);
      }
    }, 300);

    return () => window.clearTimeout(handle);
  }, [
    searchQuery,
    initialRows,
    filterHeat,
    filterCompletenessBelow,
    showArchived,
  ]);

  const countKey = showArchived
    ? "customers.countArchived"
    : isAdmin
      ? "customers.countAdmin"
      : "customers.countStaff";

  const isSearchActive = searchQuery.trim().length > 0;

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">
            {showArchived ? t("customers.archivedList") : t("customers.title")}
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            {searching
              ? t("common.loading")
              : t(countKey, { count: String(rows.length) })}
          </p>
          {isAdmin && (
            <div className="mt-2 flex gap-3 text-sm">
              {showArchived ? (
                <Link href="/customers" className="text-indigo-600 hover:underline">
                  ← {t("customers.backToActiveList")}
                </Link>
              ) : (
                <Link
                  href="/customers?status=archived"
                  className="text-indigo-600 hover:underline"
                >
                  {t("customers.viewArchived")}
                </Link>
              )}
            </div>
          )}
        </div>
        {!showArchived && (
          <Link
            href="/customers/new"
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
          >
            {t("customers.addClient")}
          </Link>
        )}
      </div>

      <div className="mb-4">
        <input
          type="search"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={t("customers.searchPlaceholder")}
          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
        />
      </div>

      {!showArchived && (
        <form
          method="get"
          className="mb-4 flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-4"
        >
          <div>
            <label htmlFor="heat" className="block text-xs font-medium text-slate-600">
              {t("customers.heatLevel")}
            </label>
            <select
              id="heat"
              name="heat"
              defaultValue={filterHeat ?? ""}
              className="mt-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            >
              <option value="">{t("common.all")}</option>
              {HEAT_LEVELS.map((level) => (
                <option key={level} value={level}>
                  {heatLevel(level)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label
              htmlFor="completenessBelow"
              className="block text-xs font-medium text-slate-600"
            >
              {t("customers.completenessBelow")}
            </label>
            <input
              id="completenessBelow"
              name="completenessBelow"
              type="number"
              min={0}
              max={100}
              placeholder="60"
              defaultValue={filterCompletenessBelow ?? ""}
              className="mt-1 w-24 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
          </div>
          <button
            type="submit"
            className="rounded-lg bg-slate-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-900"
          >
            {t("common.filter")}
          </button>
          {(filterHeat || filterCompletenessBelow) && (
            <Link
              href={`/customers${baseQuery}`}
              className="text-sm text-slate-500 hover:underline"
            >
              {t("customers.clearFilters")}
            </Link>
          )}
        </form>
      )}

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-12 text-center">
          <p className="text-slate-500">
            {isSearchActive
              ? t("customers.noSearchResults")
              : showArchived
                ? t("customers.noArchivedClients")
                : t("customers.noCustomers")}
          </p>
          {!showArchived && !isSearchActive && (
            <Link
              href="/customers/new"
              className="mt-4 inline-block text-sm text-indigo-600 hover:underline"
            >
              {t("customers.addFirstClient")}
            </Link>
          )}
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 bg-slate-50">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-slate-600">
                  {t("customers.clientName")}
                </th>
                <th className="px-4 py-3 text-left font-medium text-slate-600">
                  {t("customers.type")}
                </th>
                <th className="px-4 py-3 text-left font-medium text-slate-600">
                  {t("customers.source")}
                </th>
                <th className="px-4 py-3 text-left font-medium text-slate-600">
                  {t("customers.salesStage")}
                </th>
                <th className="px-4 py-3 text-left font-medium text-slate-600">
                  {t("customers.status")}
                </th>
                <th className="px-4 py-3 text-left font-medium text-slate-600">
                  {t("customers.heatLevel")}
                </th>
                <th className="px-4 py-3 text-left font-medium text-slate-600">
                  {t("customers.completeness")}
                </th>
                <th className="px-4 py-3 text-left font-medium text-slate-600">
                  {t("customers.followUpStatus")}
                </th>
                <th className="px-4 py-3 text-left font-medium text-slate-600">
                  {t("customers.dataAccess")}
                </th>
                <th className="px-4 py-3 text-left font-medium text-slate-600">
                  {t("customers.createdAt")}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((c) => (
                <tr key={c.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <Link
                      href={`/customers/${c.id}`}
                      className="font-medium text-indigo-600 hover:underline"
                    >
                      {c.customerCode ? (
                        <>
                          <span className="mr-2 font-mono text-xs text-slate-500">
                            {c.customerCode}
                          </span>
                          {c.customerName}
                        </>
                      ) : (
                        c.customerName
                      )}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {customerType(c.customerType)}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{source(c.source)}</td>
                  <td className="px-4 py-3 text-slate-600">{salesStage(c.salesStage)}</td>
                  <td className="px-4 py-3">
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                      {status(c.status)}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <HeatBadge level={c.heatLevel} />
                  </td>
                  <td className="px-4 py-3">
                    <CompletenessBadge score={c.completenessScore} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {c.neverContacted && (
                        <span className="rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-700">
                          {t("customers.neverContacted")}
                        </span>
                      )}
                      {c.overdueFollowUp && (
                        <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                          {t("customers.overdueFollowUp")}
                        </span>
                      )}
                      {!c.neverContacted && !c.overdueFollowUp && (
                        <span className="text-xs text-slate-400">—</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {c.isArchived ? (
                      <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-600">
                        {t("customers.archivedBadge")}
                      </span>
                    ) : c.isMasked ? (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
                        {t("customers.masked")}
                      </span>
                    ) : (
                      <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                        {t("customers.fullData")}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-500">{c.createdAt.slice(0, 10)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
