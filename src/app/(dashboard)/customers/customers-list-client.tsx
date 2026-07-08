"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useCustomerLabels } from "@/i18n/use-customer-labels";
import { useTranslation } from "@/i18n/provider";
import type { Locale } from "@/i18n/config";
import {
  CompletenessBadge,
  HeatBadge,
} from "@/components/customers/customer-scores-cards";
import { PinnedBadge } from "@/components/customers/pinned-badge";
import { Button } from "@/components/ui/button";
import { Badge, EmptyState } from "@/components/ui/card";
import { PageIntro } from "@/components/ui/page-intro";
import { Input, Label, Select } from "@/components/ui/form";
import { LoadingSpinner } from "@/components/ui/loading";
import {
  Pagination,
  buildCustomerListHref,
  type PaginationMeta,
} from "@/components/ui/pagination";
import { formatHongKongDate } from "@/lib/timezone";
import {
  DataTable,
  TableBody,
  TableHead,
  TableShell,
  Td,
  Th,
  Tr,
} from "@/components/ui/table";
import type { CustomerListRowData } from "@/lib/customers/list-rows";
import { formatProjectNameForList } from "@/lib/customers/list-rows";
import {
  getSalesStageBadgeClass,
  resolveSalesStageListDisplay,
} from "@/lib/customers/sales-stage-badges";
import {
  resolveAssigneeStaffForList,
  type AssigneeDisplayLocale,
} from "@/lib/customers/assignee-display";
import {
  CUSTOMER_LIST_PAGE_SIZE,
  type CustomerCreatorOption,
} from "@/lib/customers/queries";
import { ui } from "@/lib/ui/classes";

export type CustomerListRow = CustomerListRowData;

type Props = {
  initialRows: CustomerListRow[];
  pagination: PaginationMeta;
  showArchived: boolean;
  isAdmin: boolean;
  filterCreatedBy?: string;
  creatorOptions: CustomerCreatorOption[];
  heatFilter?: string;
  completenessBelowFilter?: string;
};

type ApiCustomerItem = CustomerListRow & {
  isArchived?: boolean;
};

type ApiCustomersResponse = {
  items?: ApiCustomerItem[];
  page?: number;
  pageSize?: number;
  total?: number;
  pageCount?: number;
};

function mapApiItem(item: ApiCustomerItem): CustomerListRow {
  return {
    id: item.id,
    customerCode: item.customerCode,
    customerName: item.customerName,
    ownerId: item.ownerId ?? null,
    ownerName: item.ownerName ?? null,
    assigneeNames: item.assigneeNames ?? [],
    requestedProjectName: item.requestedProjectName,
    salesStage: item.salesStage,
    lifecycleStatus: item.lifecycleStatus ?? null,
    status: item.status,
    heatLevel: item.heatLevel,
    completenessScore: item.completenessScore,
    neverContacted: item.neverContacted,
    overdueFollowUp: item.overdueFollowUp,
    isArchived: item.isArchived ?? false,
    isMasked: item.isMasked,
    isPinned: item.isPinned ?? false,
    pinnedAt: item.pinnedAt ?? null,
    createdAt: item.createdAt,
  };
}

export function CustomersListClient({
  initialRows,
  pagination,
  showArchived,
  isAdmin,
  filterCreatedBy,
  creatorOptions,
  heatFilter,
  completenessBelowFilter,
}: Props) {
  const { t, salesStage, status } = useCustomerLabels();
  const { t: tCommon, locale } = useTranslation();
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<CustomerListRow[] | null>(
    null,
  );
  const [searchPagination, setSearchPagination] = useState<PaginationMeta | null>(
    null,
  );
  const [searchPage, setSearchPage] = useState(1);
  const [searching, setSearching] = useState(false);

  const isSearchActive = searchQuery.trim().length > 0;
  const rows = isSearchActive ? (searchResults ?? []) : initialRows;
  const activePagination = isSearchActive
    ? (searchPagination ?? pagination)
    : pagination;

  useEffect(() => {
    setSearchPage(1);
  }, [searchQuery, filterCreatedBy, showArchived]);

  useEffect(() => {
    const q = searchQuery.trim();
    if (!q) {
      setSearchResults(null);
      setSearchPagination(null);
      return;
    }

    const handle = window.setTimeout(async () => {
      setSearching(true);
      try {
        const params = new URLSearchParams({
          q,
          page: String(searchPage),
          pageSize: String(CUSTOMER_LIST_PAGE_SIZE),
        });
        if (filterCreatedBy) params.set("createdBy", filterCreatedBy);
        if (showArchived) params.set("status", "archived");
        if (heatFilter) params.set("heat", heatFilter);
        if (completenessBelowFilter) {
          params.set("completenessBelow", completenessBelowFilter);
        }

        const res = await fetch(`/api/customers?${params.toString()}`);
        const data = (await res.json()) as ApiCustomersResponse;
        if (res.ok && data.items) {
          setSearchResults(data.items.map(mapApiItem));
          setSearchPagination({
            page: data.page ?? searchPage,
            pageSize: data.pageSize ?? pagination.pageSize,
            total: data.total ?? data.items.length,
            pageCount: data.pageCount ?? 1,
          });
        }
      } finally {
        setSearching(false);
      }
    }, 300);

    return () => window.clearTimeout(handle);
  }, [
    searchQuery,
    searchPage,
    filterCreatedBy,
    showArchived,
    heatFilter,
    completenessBelowFilter,
    pagination.pageSize,
  ]);

  const countKey = showArchived
    ? "customers.countArchived"
    : isAdmin
      ? "customers.countAdmin"
      : "customers.countStaff";

  const clearFiltersHref = showArchived ? "/customers?status=archived" : "/customers";

  function buildListPageHref(page: number): string {
    return buildCustomerListHref({
      page,
      createdBy: filterCreatedBy,
      status: showArchived ? "archived" : undefined,
      heat: heatFilter,
      completenessBelow: completenessBelowFilter,
    });
  }

  function assigneeDisplayLocale(currentLocale: Locale): AssigneeDisplayLocale {
    return currentLocale === "en" ? "en" : "zh";
  }

  function assignedStaffDisplay(c: CustomerListRow) {
    return resolveAssigneeStaffForList(
      {
        status: c.status,
        ownerId: c.ownerId,
        ownerName: c.ownerName,
        assigneeNames: c.assigneeNames,
      },
      {
        publicPool: t("customers.statusPublicPool"),
        unknownStaff: t("customers.unknownStaff"),
      },
      assigneeDisplayLocale(locale),
    );
  }

  function AssignedStaffCell({ c }: { c: CustomerListRow }) {
    const { display, title } = assignedStaffDisplay(c);
    return (
      <span className="crm-text" title={title}>
        {display}
      </span>
    );
  }

  function CustomerNameLink({ c }: { c: CustomerListRow }) {
    return (
      <span className="inline-flex flex-col gap-0.5">
        <span className="inline-flex items-center gap-2">
          <Link href={`/customers/${c.id}`} className={ui.customerName}>
            {c.customerName}
          </Link>
          {c.isPinned && <PinnedBadge />}
        </span>
        {isAdmin && c.customerCode && (
          <span className={ui.customerCode}>{c.customerCode}</span>
        )}
      </span>
    );
  }

  function ProjectNameCell({ name }: { name?: string | null }) {
    const { display, title } = formatProjectNameForList(name);
    return (
      <span className="crm-text" title={title}>
        {display}
      </span>
    );
  }

  function SalesStageCell({ c }: { c: CustomerListRow }) {
    const display = resolveSalesStageListDisplay({
      lifecycleStatus: c.lifecycleStatus,
      status: c.status,
      isArchived: c.isArchived,
      salesStage: c.salesStage,
    });

    let label: string;
    let badgeKey: string;

    if (display === "pending_second_conversion") {
      label = t("customers.pendingSecondConversion");
      badgeKey = "pending_second_conversion";
    } else if (display === "negotiation_reminder") {
      label = salesStage("negotiation");
      badgeKey = "negotiation_reminder";
    } else {
      label = salesStage(c.salesStage);
      badgeKey = c.salesStage;
    }

    return (
      <span
        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${getSalesStageBadgeClass(badgeKey)}`}
      >
        {label}
      </span>
    );
  }

  function CustomerMobileCard({ c }: { c: CustomerListRow }) {
    const project = formatProjectNameForList(c.requestedProjectName);
    const staff = assignedStaffDisplay(c);

    return (
      <Link
        href={`/customers/${c.id}`}
        className="interactive-card block p-4 active:scale-[0.99]"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className={`truncate font-semibold ${ui.customerName}`}>
                {c.customerName}
              </p>
              {c.isPinned && <PinnedBadge />}
            </div>
            {isAdmin && c.customerCode && (
              <p className={`mt-0.5 ${ui.customerCode}`}>{c.customerCode}</p>
            )}
            <p className="mt-1 text-xs crm-text-secondary">
              <span title={staff.title}>{staff.display}</span> ·{" "}
              <SalesStageCell c={c} />
            </p>
            <p className="mt-0.5 text-xs crm-text-secondary" title={project.title}>
              {project.display}
            </p>
          </div>
          <HeatBadge level={c.heatLevel} />
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          <Badge>{status(c.status)}</Badge>
          <CompletenessBadge score={c.completenessScore} />
          {c.neverContacted && <Badge variant="warning">{t("customers.neverContacted")}</Badge>}
          {c.overdueFollowUp && <Badge variant="danger">{t("customers.overdueFollowUp")}</Badge>}
        </div>
      </Link>
    );
  }

  return (
    <div>
      <PageIntro
        title={showArchived ? t("customers.archivedList") : t("customers.title")}
        description={
          searching
            ? t("common.loading")
            : t(countKey, { count: String(activePagination.total) })
        }
        action={
          !showArchived ? (
            <Link href="/customers/new">
              <Button size="lg" className="w-full sm:w-auto">
                {t("customers.addClient")}
              </Button>
            </Link>
          ) : undefined
        }
      />
      {isAdmin && (
        <div className="mb-4 flex gap-3 text-sm">
          {showArchived ? (
            <Link href="/customers" className="link-primary">
              ← {t("customers.backToActiveList")}
            </Link>
          ) : (
            <Link href="/customers?status=archived" className="link-primary">
              {t("customers.viewArchived")}
            </Link>
          )}
        </div>
      )}
      {searching && (
        <p className="mb-4 flex items-center gap-2 text-sm crm-text-secondary">
          <LoadingSpinner size="sm" />
          {t("common.loading")}
        </p>
      )}

      <div className="mb-4">
        <Input
          type="search"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={t("customers.searchPlaceholder")}
        />
      </div>

      {isAdmin && (
        <form
          method="get"
          className="surface-card mb-4 flex flex-col gap-4 p-4 sm:flex-row sm:flex-wrap sm:items-end"
        >
          {showArchived && (
            <input type="hidden" name="status" value="archived" />
          )}
          <div className="min-w-[180px] flex-1">
            <Label htmlFor="createdBy">{t("customers.filterCreatedBy")}</Label>
            <Select
              id="createdBy"
              name="createdBy"
              defaultValue={filterCreatedBy ?? ""}
            >
              <option value="">{t("customers.allCreators")}</option>
              {creatorOptions.map((creator) => (
                <option key={creator.id} value={creator.id}>
                  {creator.displayName}
                </option>
              ))}
            </Select>
          </div>
          <Button type="submit" variant="secondary">
            {t("common.filter")}
          </Button>
          {filterCreatedBy && (
            <Link
              href={clearFiltersHref}
              className="text-sm crm-text-secondary hover:underline sm:mb-2"
            >
              {t("customers.clearFilters")}
            </Link>
          )}
        </form>
      )}

      {rows.length === 0 && !(isSearchActive && searching) ? (
        <EmptyState
          message={
            isSearchActive
              ? t("customers.noSearchResults")
              : showArchived
                ? t("customers.noArchivedClients")
                : t("customers.noCustomers")
          }
          action={
            !showArchived && !isSearchActive ? (
              <Link href="/customers/new">
                <Button variant="secondary">{t("customers.addFirstClient")}</Button>
              </Link>
            ) : undefined
          }
        />
      ) : (
        <>
          <div className="space-y-3 md:hidden">
            {rows.map((c) => (
              <CustomerMobileCard key={c.id} c={c} />
            ))}
          </div>

          <TableShell className="hidden md:block">
            <DataTable>
              <TableHead>
                <tr>
                  <Th>{t("customers.clientName")}</Th>
                  <Th>{t("customers.assignedStaff")}</Th>
                  <Th>{t("customers.projectName")}</Th>
                  <Th>{t("customers.salesStage")}</Th>
                  <Th>{t("customers.status")}</Th>
                  <Th>{t("customers.heatLevel")}</Th>
                  <Th>{t("customers.completeness")}</Th>
                  <Th>{t("customers.followUpStatus")}</Th>
                  <Th>{t("customers.dataAccess")}</Th>
                  <Th>{t("customers.createdAt")}</Th>
                </tr>
              </TableHead>
              <TableBody>
                {rows.map((c) => (
                  <Tr key={c.id}>
                    <Td>
                      <CustomerNameLink c={c} />
                    </Td>
                    <Td>
                      <AssignedStaffCell c={c} />
                    </Td>
                    <Td>
                      <ProjectNameCell name={c.requestedProjectName} />
                    </Td>
                    <Td>
                      <SalesStageCell c={c} />
                    </Td>
                    <Td>
                      <Badge>{status(c.status)}</Badge>
                    </Td>
                    <Td>
                      <HeatBadge level={c.heatLevel} />
                    </Td>
                    <Td>
                      <CompletenessBadge score={c.completenessScore} />
                    </Td>
                    <Td>
                      <div className="flex flex-wrap gap-1">
                        {c.neverContacted && (
                          <Badge variant="warning">{t("customers.neverContacted")}</Badge>
                        )}
                        {c.overdueFollowUp && (
                          <Badge variant="danger">{t("customers.overdueFollowUp")}</Badge>
                        )}
                        {!c.neverContacted && !c.overdueFollowUp && (
                          <span className="text-xs crm-text-secondary">—</span>
                        )}
                      </div>
                    </Td>
                    <Td>
                      {c.isArchived ? (
                        <Badge>{t("customers.archivedBadge")}</Badge>
                      ) : c.isMasked ? (
                        <Badge variant="warning">{t("customers.masked")}</Badge>
                      ) : (
                        <Badge variant="success">{t("customers.fullData")}</Badge>
                      )}
                    </Td>
                    <Td className="crm-text-secondary">{formatHongKongDate(c.createdAt)}</Td>
                  </Tr>
                ))}
              </TableBody>
            </DataTable>
          </TableShell>

          <Pagination
            page={activePagination.page}
            pageCount={activePagination.pageCount}
            buildHref={isSearchActive ? undefined : buildListPageHref}
            onPageChange={isSearchActive ? setSearchPage : undefined}
            prevLabel={tCommon("common.prevPage")}
            nextLabel={tCommon("common.nextPage")}
          />
        </>
      )}
    </div>
  );
}
