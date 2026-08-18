"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import Link from "next/link";
import { CompletenessBadge } from "@/components/customers/customer-scores-cards";
import { CustomerNameLabel } from "@/components/customers/customer-name-label";
import { EmptyState } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  DataTable,
  TableBody,
  TableHead,
  TableShell,
  Td,
  Th,
  Tr,
} from "@/components/ui/table";
import { useTranslation } from "@/i18n/provider";
import { resolveApiError } from "@/i18n/resolve-api-error";
import { resolveClaimBlockReason } from "@/i18n/resolve-claim-block-reason";
import { useCustomerLabels } from "@/i18n/use-customer-labels";
import { getSalesStageBadgeClass } from "@/lib/customers/sales-stage-badges";
import {
  canLinkPublicPoolCustomerToDetail,
  displayStaffPoolReasonPreview,
  formatPublicPoolAdminContact,
  formatPublicPoolDateCell,
} from "@/lib/public-pool/display";
import {
  displayPublicPoolReason,
  isAdminPublicPoolCustomerView,
  type PublicPoolCustomerView,
} from "@/lib/public-pool/queries";
import { formatHongKongDateTime } from "@/lib/timezone";
import { PublicPoolMobileCard } from "./public-pool-mobile-card";
import { PublicPoolReasonDisplay } from "./public-pool-reason-display";
import {
  shouldShowActionsColumn,
  shouldShowRowClaimButton,
} from "./random-claim-ui";

export function PublicPoolClient({
  initialItems,
  isAdmin,
}: {
  initialItems: PublicPoolCustomerView[];
  isAdmin: boolean;
}) {
  const router = useRouter();
  const { t, locale } = useTranslation();
  const { customerType, salesStage } = useCustomerLabels();
  const [items, setItems] = useState(initialItems);
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const [claimSuccessId, setClaimSuccessId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const showRowClaim = shouldShowRowClaimButton(isAdmin);
  const showActions = shouldShowActionsColumn(isAdmin);

  useEffect(() => {
    setItems(initialItems);
  }, [initialItems]);

  function formatPoolDate(value: string | null | undefined): string {
    return formatPublicPoolDateCell(value, formatHongKongDateTime);
  }

  function displayFollowUpDate(value: string | null | undefined): string {
    const formatted = formatPoolDate(value);
    return formatted === "—" ? t("publicPool.noFollowUp") : formatted;
  }

  async function handleClaim(id: string) {
    if (!showRowClaim) return;
    setClaimingId(id);
    setError(null);
    setClaimSuccessId(null);

    try {
      const res = await fetch(`/api/public-pool/customers/${id}/claim`, {
        method: "POST",
      });
      const data = (await res.json()) as {
        ok?: boolean;
        id?: string;
        error?: string;
        errorCode?: string;
        code?: string;
      };

      if (res.ok) {
        setItems((prev) => prev.filter((c) => c.id !== id));
        setClaimSuccessId(data.id ?? id);
        router.refresh();
        return;
      }

      setError(resolveApiError(t, data));
      router.refresh();
    } catch {
      setError(t("common.networkError"));
    } finally {
      setClaimingId(null);
    }
  }

  const listEmpty = items.length === 0 && !claimSuccessId;

  const statusAlerts = (
    <>
      {claimSuccessId && (
        <div className="alert-success mb-4 flex flex-col gap-3 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
          <p className="font-medium crm-text">{t("publicPool.claimSuccess")}</p>
          <Link href={`/customers/${claimSuccessId}`}>
            <Button type="button" size="sm" variant="secondary">
              {t("publicPool.viewNow")}
            </Button>
          </Link>
        </div>
      )}

      {error && (
        <div className="alert-error mb-4 px-4 py-3 text-sm" role="alert">
          {error}
        </div>
      )}
    </>
  );

  const adminMobileCards = (
    <div className="space-y-3 md:hidden">
      {listEmpty ? (
        <EmptyState message={t("publicPool.noClients")} />
      ) : (
        items.map((c) => {
          if (!isAdminPublicPoolCustomerView(c)) return null;
          const blockReason = resolveClaimBlockReason(
            t,
            c.claimBlockedReasonKey,
            c.claimBlockedReasonParams,
          );
          return (
            <PublicPoolMobileCard
              key={c.id}
              customer={c}
              locale={locale}
              pendingNameLabel={t("customers.namePendingBadge")}
              customerTypeLabel={customerType(c.customerType)}
              sourceLabel={c.sourceDisplayLabel ?? c.source}
              salesStageLabel={salesStage(c.salesStage)}
              lastValidFollowUpLabel={t("publicPool.lastValidFollowUp")}
              lastValidFollowUpValue={displayFollowUpDate(c.lastValidFollowUpAt)}
              lastFollowUpLabel={t("publicPool.lastFollowUp")}
              lastFollowUpValue={displayFollowUpDate(c.lastFollowUpAt)}
              poolEnteredAtLabel={t("publicPool.poolEnteredAt")}
              poolEnteredAtValue={formatPoolDate(c.poolEnteredAt)}
              poolReasonLabel={t("publicPool.poolReason")}
              previousOwnerLabel={t("publicPool.previousOwner")}
              previousOwnerUnknownLabel={t("publicPool.previousOwnerUnknown")}
              phoneLabel={t("common.phone")}
              wechatLabel={t("publicPool.wechat")}
              emailLabel={t("common.email")}
              viewLabel={t("publicPool.viewNow")}
              claimLabel={t("publicPool.claim")}
              claimingLabel={t("publicPool.claiming")}
              claiming={claimingId === c.id}
              canClaim={c.canClaim}
              blockReason={blockReason}
              onClaim={() => {
                void handleClaim(c.id);
              }}
            />
          );
        })
      )}
    </div>
  );

  const poolTable = (
    <>
      {listEmpty ? (
        <EmptyState message={t("publicPool.noClients")} />
      ) : (
        <TableShell>
          <DataTable>
            <TableHead>
              <tr>
                <Th>{t("publicPool.clientName")}</Th>
                <Th>{t("publicPool.businessSummary")}</Th>
                <Th>{t("publicPool.poolDataCompleteness")}</Th>
                <Th>{t("publicPool.followUpSummary")}</Th>
                <Th>{t("publicPool.poolReason")}</Th>
                {isAdmin && <Th>{t("publicPool.contact")}</Th>}
                {showActions && <Th>{t("publicPool.actions")}</Th>}
              </tr>
            </TableHead>
            <TableBody>
              {items.map((c) => {
                const blockReason = resolveClaimBlockReason(
                  t,
                  c.claimBlockedReasonKey,
                  c.claimBlockedReasonParams,
                );
                const adminView = isAdminPublicPoolCustomerView(c);
                const poolReasonDisplay = adminView
                  ? displayPublicPoolReason(c)
                  : displayStaffPoolReasonPreview(c.poolReasonPreview);
                const contact = adminView
                  ? formatPublicPoolAdminContact(c)
                  : null;

                return (
                  <Tr key={c.id}>
                    <Td>
                      {canLinkPublicPoolCustomerToDetail(adminView) &&
                      isAdminPublicPoolCustomerView(c) ? (
                        <CustomerNameLabel
                          customerName={c.customerName || c.maskedName}
                          nameStatus={c.nameStatus}
                          locale={locale}
                          pendingLabel={t("customers.namePendingBadge")}
                          renderName={(displayName) => (
                            <Link
                              href={`/customers/${c.id}`}
                              className="link-primary font-medium hover:underline"
                            >
                              {displayName}
                            </Link>
                          )}
                        />
                      ) : (
                        <span className="font-medium crm-text">
                          {c.maskedName}
                        </span>
                      )}
                      {c.isMasked && (
                        <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700">
                          {t("publicPool.masked")}
                        </span>
                      )}
                    </Td>
                    <Td>
                      <div className="space-y-1 text-sm">
                        <span className="block crm-text">
                          {customerType(c.customerType)}
                        </span>
                        <span className="block text-xs crm-text-secondary">
                          {c.sourceDisplayLabel ?? c.source}
                        </span>
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${getSalesStageBadgeClass(c.salesStage)}`}
                        >
                          {salesStage(c.salesStage)}
                        </span>
                      </div>
                    </Td>
                    <Td>
                      <CompletenessBadge score={c.completenessScore} />
                    </Td>
                    <Td>
                      <div className="space-y-1 text-xs crm-text-secondary">
                        <div>
                          <span className="font-medium crm-text">
                            {t("publicPool.lastValidFollowUp")}:{" "}
                          </span>
                          {displayFollowUpDate(c.lastValidFollowUpAt)}
                        </div>
                        <div>
                          <span className="font-medium crm-text">
                            {t("publicPool.lastFollowUp")}:{" "}
                          </span>
                          {displayFollowUpDate(c.lastFollowUpAt)}
                        </div>
                        <div>
                          <span className="font-medium crm-text">
                            {t("publicPool.poolEnteredAt")}:{" "}
                          </span>
                          {formatPoolDate(c.poolEnteredAt)}
                        </div>
                      </div>
                    </Td>
                    <Td className="max-w-[220px] crm-text-secondary">
                      {adminView ? (
                        <PublicPoolReasonDisplay
                          poolReason={poolReasonDisplay}
                          previousOwnerDisplayName={c.previousOwnerDisplayName}
                          previousOwnerLabel={t("publicPool.previousOwner")}
                          previousOwnerUnknownLabel={t(
                            "publicPool.previousOwnerUnknown",
                          )}
                        />
                      ) : (
                        poolReasonDisplay
                      )}
                    </Td>
                    {isAdmin && contact && (
                      <Td className="crm-text-secondary">
                        <span className="block text-sm">{contact.phone}</span>
                        {contact.wechatId && (
                          <span className="block text-xs">
                            {t("publicPool.wechat")}：{contact.wechatId}
                          </span>
                        )}
                        {contact.email && (
                          <span className="block text-xs">
                            {t("common.email")}：{contact.email}
                          </span>
                        )}
                      </Td>
                    )}
                    {showActions && showRowClaim && (
                      <Td>
                        <Button
                          type="button"
                          size="sm"
                          disabled={!c.canClaim || claimingId === c.id}
                          onClick={() => {
                            void handleClaim(c.id);
                          }}
                          title={blockReason ?? undefined}
                        >
                          {claimingId === c.id
                            ? t("publicPool.claiming")
                            : t("publicPool.claim")}
                        </Button>
                        {!c.canClaim && blockReason && (
                          <p className="mt-1 max-w-[140px] text-xs text-red-600">
                            {blockReason}
                          </p>
                        )}
                      </Td>
                    )}
                  </Tr>
                );
              })}
            </TableBody>
          </DataTable>
        </TableShell>
      )}
    </>
  );

  if (!isAdmin) {
    return (
      <div className="hidden md:block">
        {statusAlerts}
        {poolTable}
      </div>
    );
  }

  return (
    <div>
      {statusAlerts}
      {adminMobileCards}
      <div className="hidden md:block">{poolTable}</div>
    </div>
  );
}
