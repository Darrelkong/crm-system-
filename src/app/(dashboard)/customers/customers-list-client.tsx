"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useCustomerLabels } from "@/i18n/use-customer-labels";
import {
  CompletenessBadge,
  HeatBadge,
} from "@/components/customers/customer-scores-cards";
import { Button } from "@/components/ui/button";
import { Badge, EmptyState } from "@/components/ui/card";
import { PageIntro } from "@/components/ui/page-intro";
import { Input, Label, Select } from "@/components/ui/form";
import { LoadingSpinner } from "@/components/ui/loading";
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
import type { CustomerCreatorOption } from "@/lib/customers/queries";

export type CustomerListRow = CustomerListRowData;

type Props = {
  initialRows: CustomerListRow[];
  showArchived: boolean;
  isAdmin: boolean;
  filterCreatedBy?: string;
  creatorOptions: CustomerCreatorOption[];
};

type ApiCustomerItem = CustomerListRow & {
  isArchived?: boolean;
};

function mapApiItem(item: ApiCustomerItem): CustomerListRow {
  return {
    id: item.id,
    customerCode: item.customerCode,
    customerName: item.customerName,
    ownerId: item.ownerId ?? null,
    ownerName: item.ownerName ?? null,
    requestedProjectName: item.requestedProjectName,
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
  filterCreatedBy,
  creatorOptions,
}: Props) {
  const { t, salesStage, status } = useCustomerLabels();
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<CustomerListRow[] | null>(null);
  const [searching, setSearching] = useState(false);

  const rows = searchQuery.trim() ? (searchResults ?? initialRows) : initialRows;

  useEffect(() => {
    const q = searchQuery.trim();
    if (!q) {
      return;
    }

    const handle = window.setTimeout(async () => {
      setSearching(true);
      try {
        const params = new URLSearchParams({ q });
        if (filterCreatedBy) params.set("createdBy", filterCreatedBy);
        if (showArchived) params.set("status", "archived");

        const res = await fetch(`/api/customers?${params.toString()}`);
        const data = (await res.json()) as { items?: ApiCustomerItem[] };
        if (res.ok && data.items) {
          setSearchResults(data.items.map(mapApiItem));
        }
      } finally {
        setSearching(false);
      }
    }, 300);

    return () => window.clearTimeout(handle);
  }, [
    searchQuery,
    filterCreatedBy,
    showArchived,
  ]);

  const countKey = showArchived
    ? "customers.countArchived"
    : isAdmin
      ? "customers.countAdmin"
      : "customers.countStaff";

  const clearFiltersHref = showArchived ? "/customers?status=archived" : "/customers";

  const isSearchActive = searchQuery.trim().length > 0;

  function ownerLabel(c: CustomerListRow): string {
    if (!c.ownerId || c.status === "public_pool") {
      return t("customers.statusPublicPool");
    }
    if (c.ownerName?.trim()) {
      return c.ownerName;
    }
    return t("customers.unknownStaff");
  }

  function CustomerNameLink({ c }: { c: CustomerListRow }) {
    const title =
      isAdmin && c.customerCode ? c.customerCode : undefined;

    return (
      <Link
        href={`/customers/${c.id}`}
        className="font-medium text-[#2F6FB3] hover:underline"
        title={title}
      >
        {c.customerName}
      </Link>
    );
  }

  function ProjectNameCell({ name }: { name?: string | null }) {
    const { display, title } = formatProjectNameForList(name);
    return (
      <span className="text-[#172033]" title={title}>
        {display}
      </span>
    );
  }

  function CustomerMobileCard({ c }: { c: CustomerListRow }) {
    const project = formatProjectNameForList(c.requestedProjectName);

    return (
      <Link
        href={`/customers/${c.id}`}
        className="interactive-card block p-4 active:scale-[0.99]"
        title={isAdmin && c.customerCode ? c.customerCode : undefined}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate font-semibold text-[#172033]">{c.customerName}</p>
            <p className="mt-1 text-xs text-[#6B7890]">
              {ownerLabel(c)} · {salesStage(c.salesStage)}
            </p>
            <p className="mt-0.5 text-xs text-[#6B7890]" title={project.title}>
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
          searching ? t("common.loading") : t(countKey, { count: String(rows.length) })
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
        <p className="mb-4 flex items-center gap-2 text-sm text-[#6B7890]">
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
              className="text-sm text-[#6B7890] hover:underline sm:mb-2"
            >
              {t("customers.clearFilters")}
            </Link>
          )}
        </form>
      )}

      {rows.length === 0 ? (
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
                    <Td className="text-[#172033]">{ownerLabel(c)}</Td>
                    <Td>
                      <ProjectNameCell name={c.requestedProjectName} />
                    </Td>
                    <Td>{salesStage(c.salesStage)}</Td>
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
                          <span className="text-xs text-[#6B7890]">—</span>
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
                    <Td className="text-[#6B7890]">{formatHongKongDate(c.createdAt)}</Td>
                  </Tr>
                ))}
              </TableBody>
            </DataTable>
          </TableShell>
        </>
      )}
    </div>
  );
}
