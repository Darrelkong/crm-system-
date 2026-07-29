"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CompositionEvent,
  type ReactNode,
} from "react";
import { Badge, Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/form";
import { PageIntro } from "@/components/ui/page-intro";
import { useTranslation } from "@/i18n/provider";
import { useCustomerLabels } from "@/i18n/use-customer-labels";
import type { FollowUpListItem } from "@/lib/follow-ups/types";
import {
  DEFAULT_FOLLOW_UP_LIST_FILTERS,
  buildFollowUpListHref,
  countActiveFollowUpListFilters,
  followUpListFiltersEqual,
  hasActiveFollowUpListFilters,
  normalizeFollowUpListSearch,
  parseFollowUpListFilters,
  type FollowUpListFilters,
} from "@/lib/follow-ups/list-filters";
import { formatHongKongDate, formatHongKongDateTime } from "@/lib/timezone";
import { CustomerNameLabel } from "@/components/customers/customer-name-label";
import { getCustomerDisplayName } from "@/lib/customers/customer-display-name";
import { cn } from "@/lib/cn";

const linkClass = "text-[#2F6FB3] hover:text-[#1F4E79] hover:underline";
const SEARCH_DEBOUNCE_MS = 300;
const compactControlClass = "min-h-11 py-2 md:min-h-10";
const compactSelectClass = cn(compactControlClass, "md:w-[160px]");
const compactStaffSelectClass = cn(compactControlClass, "md:w-[180px]");
const compactDateClass = cn(compactControlClass, "md:w-[138px]");
const compactSearchClass = cn(
  compactControlClass,
  "min-w-0 flex-1 md:w-[280px] md:flex-none md:max-w-[320px]",
);

function filtersForRole(
  filters: FollowUpListFilters,
  role: "admin" | "staff",
): FollowUpListFilters {
  if (role === "staff") {
    return { ...filters, staffUserId: "" };
  }
  return filters;
}

function applyFilters(
  items: FollowUpListItem[],
  filters: FollowUpListFilters,
  locale: string,
): FollowUpListItem[] {
  const search = filters.search.trim().toLowerCase();

  return items.filter((item) => {
    if (search) {
      const displayName = getCustomerDisplayName({
        customerName: item.customerName,
        nameStatus: item.nameStatus,
        locale,
      }).toLowerCase();
      const rawName = item.customerName.toLowerCase();
      if (!displayName.includes(search) && !rawName.includes(search)) {
        return false;
      }
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
  locale,
}: {
  item: FollowUpListItem;
  showStaff: boolean;
  followUpChannel: (key: string) => string;
  followUpOutcome: (key: string) => string;
  salesStage: (key: string) => string;
  status: (key: string) => string;
  t: (key: string) => string;
  locale: string;
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
        <CustomerNameLabel
          customerName={item.customerName}
          nameStatus={item.nameStatus}
          locale={locale}
          pendingLabel={t("customers.namePendingBadge")}
          renderName={(displayName) => (
            <Link
              href={`/customers/${item.customerId}`}
              className={`text-sm font-medium ${linkClass}`}
            >
              {displayName}
            </Link>
          )}
        />
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

function FollowUpsEmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="surface-card flex flex-col items-center justify-center px-6 py-14 text-center">
      <div className="empty-state-icon-wrap mb-4 flex h-14 w-14 items-center justify-center rounded-2xl">
        <svg
          className="h-7 w-7"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
          aria-hidden
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"
          />
        </svg>
      </div>
      <p className="text-sm font-medium crm-text">{title}</p>
      <p className="mt-1 max-w-md text-sm crm-text-secondary">{description}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function FollowUpsListClient({
  items,
  role,
  initialFilters = DEFAULT_FOLLOW_UP_LIST_FILTERS,
  listLimit,
}: {
  items: FollowUpListItem[];
  role: "admin" | "staff";
  initialFilters?: FollowUpListFilters;
  listLimit: number;
}) {
  const { t, locale } = useTranslation();
  const { followUpChannel, followUpOutcome, salesStage, status } =
    useCustomerLabels();
  const showStaff = role === "admin";

  const seeded = useMemo(
    () => filtersForRole(initialFilters, role),
    [initialFilters, role],
  );

  const [filters, setFilters] = useState<FollowUpListFilters>(seeded);
  const [searchInput, setSearchInput] = useState(seeded.search);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const composingRef = useRef(false);
  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  const clearDebounce = useCallback(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
  }, []);

  const writeUrl = useCallback(
    (nextFilters: FollowUpListFilters, mode: "push" | "replace") => {
      if (typeof window === "undefined") return;
      const effective = filtersForRole(nextFilters, role);
      const href = buildFollowUpListHref(
        window.location.pathname,
        effective,
        window.location.search,
      );
      const current = `${window.location.pathname}${window.location.search}`;
      if (href === current) return;
      if (mode === "push") {
        window.history.pushState(window.history.state, "", href);
      } else {
        window.history.replaceState(window.history.state, "", href);
      }
    },
    [role],
  );

  const commitFilters = useCallback(
    (
      nextFilters: FollowUpListFilters,
      mode: "push" | "replace",
      options?: { syncSearchInput?: boolean },
    ) => {
      const effective = filtersForRole(nextFilters, role);
      setFilters(effective);
      if (options?.syncSearchInput) {
        setSearchInput(effective.search);
      }
      writeUrl(effective, mode);
    },
    [role, writeUrl],
  );

  useEffect(() => {
    const onPopState = () => {
      clearDebounce();
      const parsed = filtersForRole(
        parseFollowUpListFilters(
          new URLSearchParams(window.location.search),
        ),
        role,
      );
      setFilters(parsed);
      setSearchInput(parsed.search);
    };
    window.addEventListener("popstate", onPopState);
    return () => {
      window.removeEventListener("popstate", onPopState);
      clearDebounce();
    };
  }, [role, clearDebounce]);

  const applySearchValue = useCallback(
    (raw: string, mode: "push" | "replace") => {
      const search = normalizeFollowUpListSearch(raw);
      const next = { ...filtersRef.current, search };
      if (followUpListFiltersEqual(filtersRef.current, next)) {
        writeUrl(next, mode);
        return;
      }
      commitFilters(next, mode);
    },
    [commitFilters, writeUrl],
  );

  const scheduleSearchCommit = useCallback(
    (raw: string) => {
      clearDebounce();
      debounceRef.current = setTimeout(() => {
        debounceRef.current = null;
        if (composingRef.current) return;
        applySearchValue(raw, "replace");
      }, SEARCH_DEBOUNCE_MS);
    },
    [applySearchValue, clearDebounce],
  );

  const onSearchChange = (value: string) => {
    setSearchInput(value);
    if (value.trim() === "") {
      clearDebounce();
      applySearchValue("", "replace");
      return;
    }
    if (composingRef.current) return;
    scheduleSearchCommit(value);
  };

  const onCompositionStart = () => {
    composingRef.current = true;
    clearDebounce();
  };

  const onCompositionEnd = (e: CompositionEvent<HTMLInputElement>) => {
    composingRef.current = false;
    const value = e.currentTarget.value;
    setSearchInput(value);
    if (value.trim() === "") {
      applySearchValue("", "replace");
      return;
    }
    scheduleSearchCommit(value);
  };

  const updateSelectFilter = <K extends keyof FollowUpListFilters>(
    key: K,
    value: FollowUpListFilters[K],
  ) => {
    clearDebounce();
    const next = { ...filtersRef.current, [key]: value };
    if (key !== "search") {
      next.search = normalizeFollowUpListSearch(searchInput);
    }
    commitFilters(next, "push", { syncSearchInput: true });
  };

  const clearAllFilters = () => {
    clearDebounce();
    commitFilters(DEFAULT_FOLLOW_UP_LIST_FILTERS, "push", {
      syncSearchInput: true,
    });
  };

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

  const activeFilters = useMemo(
    () => hasActiveFollowUpListFilters(filters),
    [filters],
  );

  const activeFilterCount = useMemo(
    () => countActiveFollowUpListFilters(filters),
    [filters],
  );

  const filteredItems = useMemo(
    () => applyFilters(items, filters, locale),
    [items, filters, locale],
  );

  const dateRangeSummary = useMemo(() => {
    if (filters.fromDate && filters.toDate) {
      return `${filters.fromDate} – ${filters.toDate}`;
    }
    if (filters.fromDate) return `${filters.fromDate} –`;
    if (filters.toDate) return `– ${filters.toDate}`;
    return "";
  }, [filters.fromDate, filters.toDate]);

  const staffNameById = useMemo(() => {
    const map = new Map(staffOptions);
    return map;
  }, [staffOptions]);

  const activeFilterChips = useMemo(() => {
    const chips: string[] = [];
    if (filters.search) chips.push(filters.search);
    if (dateRangeSummary) chips.push(dateRangeSummary);
    if (filters.channel) chips.push(followUpChannel(filters.channel));
    if (filters.staffUserId) {
      chips.push(
        staffNameById.get(filters.staffUserId) ?? filters.staffUserId,
      );
    }
    return chips;
  }, [
    filters.search,
    filters.channel,
    filters.staffUserId,
    dateRangeSummary,
    followUpChannel,
    staffNameById,
  ]);

  const showNoDataEmpty = items.length === 0;
  const showFilteredEmpty =
    items.length > 0 && filteredItems.length === 0 && activeFilters;
  const showDefensiveEmpty =
    items.length > 0 && filteredItems.length === 0 && !activeFilters;

  const searchControl = (idSuffix: string, className?: string) => (
    <Input
      id={`follow-up-search${idSuffix}`}
      value={searchInput}
      onChange={(e) => onSearchChange(e.target.value)}
      onCompositionStart={onCompositionStart}
      onCompositionEnd={onCompositionEnd}
      placeholder={t("followUpsPage.searchCustomerPlaceholder")}
      aria-label={t("followUpsPage.searchCustomer")}
      maxLength={200}
      autoComplete="off"
      className={cn(compactSearchClass, className)}
    />
  );

  const dateRangeControls = (idSuffix: string) => (
    <div
      className="flex min-w-0 flex-wrap items-center gap-1.5"
      role="group"
      aria-label={t("followUpsPage.dateRange")}
    >
      <Input
        id={`follow-up-from${idSuffix}`}
        type="date"
        value={filters.fromDate}
        onChange={(e) => updateSelectFilter("fromDate", e.target.value)}
        aria-label={t("followUpsPage.fromDate")}
        className={compactDateClass}
      />
      <span className="shrink-0 text-xs crm-text-muted" aria-hidden>
        –
      </span>
      <Input
        id={`follow-up-to${idSuffix}`}
        type="date"
        value={filters.toDate}
        onChange={(e) => updateSelectFilter("toDate", e.target.value)}
        aria-label={t("followUpsPage.toDate")}
        className={compactDateClass}
      />
    </div>
  );

  const channelControl = (idSuffix: string) => (
    <Select
      id={`follow-up-channel${idSuffix}`}
      value={filters.channel}
      onChange={(e) => updateSelectFilter("channel", e.target.value)}
      aria-label={t("followUpsPage.channelFilter")}
      className={compactSelectClass}
    >
      <option value="">{t("followUpsPage.allChannels")}</option>
      {channelOptions.map((channel) => (
        <option key={channel} value={channel}>
          {followUpChannel(channel)}
        </option>
      ))}
    </Select>
  );

  const staffControl = (idSuffix: string) =>
    showStaff ? (
      <Select
        id={`follow-up-staff${idSuffix}`}
        value={filters.staffUserId}
        onChange={(e) => updateSelectFilter("staffUserId", e.target.value)}
        aria-label={t("followUpsPage.staffFilter")}
        className={compactStaffSelectClass}
      >
        <option value="">{t("followUpsPage.allStaff")}</option>
        {staffOptions.map(([id, name]) => (
          <option key={id} value={id}>
            {name}
          </option>
        ))}
      </Select>
    ) : null;

  const clearFiltersControl = activeFilters ? (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={clearAllFilters}
      className="shrink-0"
    >
      {t("followUpsPage.clearAllFilters")}
    </Button>
  ) : null;

  return (
    <div className="space-y-4 md:space-y-5">
      <PageIntro
        title={t("followUpsPage.title")}
        description={
          role === "admin"
            ? t("followUpsPage.adminDescription")
            : t("followUpsPage.staffDescription")
        }
      />

      {/* Mobile: search + filter entry only */}
      <div className="space-y-2 md:hidden" data-follow-ups-mobile-toolbar>
        <div className="flex items-center gap-2">
          {searchControl("-mobile")}
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="min-h-11 shrink-0 px-3"
            aria-expanded={mobileFiltersOpen}
            aria-controls="follow-ups-mobile-filters"
            onClick={() => setMobileFiltersOpen((open) => !open)}
          >
            {activeFilterCount > 0
              ? t("followUpsPage.filtersWithCount", {
                  count: String(activeFilterCount),
                })
              : t("followUpsPage.filters")}
          </Button>
        </div>
        {activeFilterCount > 0 && (
          <div
            className="flex max-w-full gap-1.5 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            data-follow-ups-active-chips
            aria-label={t("followUpsPage.activeFilters")}
          >
            {activeFilterChips.map((chip) => (
              <span
                key={chip}
                className="max-w-[10rem] shrink-0 truncate rounded-md border border-[color:var(--crm-border-subtle,#E3E8F0)] px-2 py-1 text-[11px] leading-tight crm-text-secondary"
              >
                {chip}
              </span>
            ))}
          </div>
        )}
        {mobileFiltersOpen && (
          <div
            id="follow-ups-mobile-filters"
            className="space-y-3 rounded-xl border border-[color:var(--crm-border-subtle,#E3E8F0)] p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
            data-follow-ups-mobile-panel
          >
            <p className="text-sm font-medium crm-text">
              {t("followUpsPage.filters")}
            </p>
            <div className="space-y-2">
              <p className="text-xs crm-text-secondary">
                {t("followUpsPage.dateRange")}
              </p>
              {dateRangeControls("-mobile")}
            </div>
            {channelControl("-mobile")}
            {staffControl("-mobile")}
            {clearFiltersControl}
          </div>
        )}
      </div>

      {/* Desktop / tablet: compact toolbar */}
      <div
        className="hidden flex-wrap items-center gap-2 md:flex"
        data-follow-ups-desktop-toolbar
      >
        {searchControl("-desktop")}
        {dateRangeControls("-desktop")}
        {channelControl("-desktop")}
        {staffControl("-desktop")}
        {clearFiltersControl}
      </div>

      {!showNoDataEmpty && (
        <p
          className="text-xs leading-relaxed crm-text-secondary"
          data-follow-ups-result-summary
        >
          {t("followUpsPage.resultSummary", {
            count: String(filteredItems.length),
            limit: String(listLimit),
          })}
        </p>
      )}

      {showNoDataEmpty || showDefensiveEmpty ? (
        <FollowUpsEmptyState
          title={t("followUpsPage.emptyTitle")}
          description={t("followUpsPage.emptyDescription")}
          action={
            <Link href="/customers" className="link-primary text-sm">
              {t("nav.customers")}
            </Link>
          }
        />
      ) : showFilteredEmpty ? (
        <FollowUpsEmptyState
          title={t("followUpsPage.emptyFilteredTitle")}
          description={t("followUpsPage.emptyFilteredDescription")}
          action={
            <Button type="button" variant="secondary" onClick={clearAllFilters}>
              {t("followUpsPage.clearAllFilters")}
            </Button>
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
                  locale={locale}
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
                      <CustomerNameLabel
                        customerName={item.customerName}
                        nameStatus={item.nameStatus}
                        locale={locale}
                        pendingLabel={t("customers.namePendingBadge")}
                        renderName={(displayName) => (
                          <Link
                            href={`/customers/${item.customerId}`}
                            className={`font-medium ${linkClass}`}
                          >
                            {displayName}
                          </Link>
                        )}
                      />
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
                        <Badge variant="accent">
                          {status(item.customerStatus)}
                        </Badge>
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
