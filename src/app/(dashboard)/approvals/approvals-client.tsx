"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { SerializedApprovalListItem } from "@/lib/approvals/family-link-serialization";
import { LinkFamilyCustomerApprovalDetail } from "@/components/approvals/link-family-customer-detail";
import { FamilyManagementApprovalDetail } from "@/components/approvals/family-management-approval-detail";
import { PriorityCustomerApprovalDetail } from "@/components/approvals/priority-customer-approval-detail";
import type { ApprovalRequestType, ApprovalStatus } from "../../../../drizzle/schema/approvals";
import { EmptyState } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ModalOverlay, ModalPanel } from "@/components/ui/modal";
import { cn } from "@/lib/cn";
import { Input, Label, Field } from "@/components/ui/form";
import { useTranslation } from "@/i18n/provider";
import { resolveApiError } from "@/i18n/resolve-api-error";
import { useCustomerLabels } from "@/i18n/use-customer-labels";
import { CreateOnHoldCustomerApprovalDetail } from "@/components/approvals/create-on-hold-customer-detail";
import { UpdateCustomerAssigneesApprovalDetail } from "@/components/approvals/update-customer-assignees-detail";
import { CustomerNameLabel } from "@/components/customers/customer-name-label";
import { formatHongKongDateTime } from "@/lib/timezone";

type Props = {
  isAdmin: boolean;
};

const STATUS_FILTERS = ["pending", "approved", "rejected", "all"] as const;

export function ApprovalsClient({ isAdmin }: Props) {
  const { t, locale } = useTranslation();
  const { approvalType, approvalStatus } = useCustomerLabels();
  const [items, setItems] = useState<SerializedApprovalListItem[]>([]);
  const [statusFilter, setStatusFilter] = useState<ApprovalStatus | "all">("pending");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [adminComment, setAdminComment] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const selected = items.find((item) => item.id === selectedId) ?? null;

  function statusLabel(status: ApprovalStatus | "all") {
    if (status === "all") return t("approvals.all");
    return approvalStatus(status);
  }

  async function loadItems(filter: ApprovalStatus | "all") {
    setLoading(true);
    setError(null);
    try {
      const query = filter === "all" ? "" : `?status=${filter}`;
      const res = await fetch(`/api/approvals${query}`);
      const data = (await res.json()) as {
        items?: SerializedApprovalListItem[];
        error?: string;
        errorCode?: string;
        code?: string;
      };
      if (!res.ok) {
        setError(resolveApiError(t, data));
        return;
      }
      setItems(data.items ?? []);
    } catch {
      setError(t("common.networkError"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadItems(statusFilter);
  }, [statusFilter]);

  async function handleReview(action: "approve" | "reject") {
    if (!selected) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/approvals/${selected.id}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adminComment }),
      });
      const data = (await res.json()) as {
        error?: string;
        errorCode?: string;
        code?: string;
      };
      if (!res.ok) {
        setError(resolveApiError(t, data));
        return;
      }
      setSelectedId(null);
      setAdminComment("");
      await loadItems(statusFilter);
    } catch {
      setError(t("common.networkError"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {STATUS_FILTERS.map((status) => (
          <button
            key={status}
            type="button"
            onClick={() => setStatusFilter(status)}
            className={cn(
              "tab-pill",
              statusFilter === status && "tab-pill-active",
            )}
          >
            {statusLabel(status)}
          </button>
        ))}
      </div>

      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}

      {loading ? (
        <p className="text-sm text-[#6B7890]">{t("common.loading")}</p>
      ) : items.length === 0 ? (
        <EmptyState message={t("approvals.noRequests")} />
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                setSelectedId(item.id);
                setAdminComment(item.adminComment ?? "");
              }}
              className="list-row w-full p-4 text-left"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-[#172033]">
                  {approvalType(item.requestType as ApprovalRequestType)}
                </span>
                <span className="status-badge">
                  {approvalStatus(item.status)}
                </span>
              </div>
              <p className="mt-1 text-sm text-[#172033]">
                {t("approvals.customer")}：
                {item.requestType === "create_on_hold_customer" ? (
                  <CustomerNameLabel
                    className="ml-1 align-middle font-medium"
                    customerName={item.customerName}
                    nameStatus={item.nameStatus}
                    locale={locale}
                    pendingLabel={t("customers.namePendingBadge")}
                    nameClassName="font-medium"
                  />
                ) : (
                  <CustomerNameLabel
                    className="ml-1 align-middle"
                    customerName={item.customerName}
                    nameStatus={item.nameStatus}
                    locale={locale}
                    pendingLabel={t("customers.namePendingBadge")}
                    renderName={(displayName) => (
                      <Link
                        href={`/customers/${item.customerId}`}
                        className="text-[#2F6FB3] hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {displayName}
                      </Link>
                    )}
                  />
                )}
              </p>
              <p className="mt-1 text-xs text-[#6B7890]">
                {t("approvals.submittedAt", {
                  name: item.requestedByName,
                  date: formatHongKongDateTime(item.createdAt),
                })}
              </p>
            </button>
          ))}
        </div>
      )}

      {selected && (
        <ModalOverlay onClose={() => setSelectedId(null)}>
          <ModalPanel>
            <h3 className="text-lg font-semibold text-[#172033]">
              {t("approvals.detailTitle")}
            </h3>
            <dl className="mt-4 space-y-2 text-sm">
              {selected.requestType !== "create_on_hold_customer" &&
                selected.requestType !== "update_customer_assignees" && (
                <div>
                  <dt className="text-[#6B7890]">{t("approvals.type")}</dt>
                  <dd>{approvalType(selected.requestType as ApprovalRequestType)}</dd>
                </div>
              )}
              <div>
                <dt className="text-[#6B7890]">{t("approvals.customer")}</dt>
                <dd>
                  <CustomerNameLabel
                    customerName={selected.customerName}
                    nameStatus={selected.nameStatus}
                    locale={locale}
                    pendingLabel={t("customers.namePendingBadge")}
                  />
                </dd>
              </div>
              <div>
                <dt className="text-[#6B7890]">{t("approvals.requestedBy")}</dt>
                <dd>{selected.requestedByName}</dd>
              </div>
              {selected.requestType !== "create_on_hold_customer" &&
                selected.requestType !== "update_customer_assignees" &&
                selected.requestType !== "set_priority_customer" &&
                selected.requestType !== "unset_priority_customer" &&
                selected.requestType !== "link_family_customer" &&
                selected.requestType !== "update_family_relationship" &&
                selected.requestType !== "unlink_family_customer" && (
                <div>
                  <dt className="text-[#6B7890]">{t("approvals.reason")}</dt>
                  <dd className="whitespace-pre-wrap">{selected.reason}</dd>
                </div>
              )}
              {selected.targetUserName && (
                <div>
                  <dt className="text-[#6B7890]">{t("approvals.transferTarget")}</dt>
                  <dd>{selected.targetUserName}</dd>
                </div>
              )}
              {selected.relatedCustomerIds &&
                selected.relatedCustomerIds.length > 0 &&
                selected.requestType !== "link_family_customer" &&
                selected.requestType !== "update_family_relationship" &&
                selected.requestType !== "unlink_family_customer" && (
                <div>
                  <dt className="text-[#6B7890]">{t("approvals.relatedCustomerIds")}</dt>
                  <dd>{selected.relatedCustomerIds.join(", ")}</dd>
                </div>
              )}
              {selected.requestType === "create_on_hold_customer" ? (
                <CreateOnHoldCustomerApprovalDetail
                  reason={selected.reason}
                  payload={selected.payload ?? null}
                  nameStatus={selected.nameStatus}
                />
              ) : selected.requestType === "update_customer_assignees" ? (
                <UpdateCustomerAssigneesApprovalDetail
                  reason={selected.reason}
                  payload={selected.payload ?? null}
                />
              ) : selected.requestType === "link_family_customer" ? (
                <LinkFamilyCustomerApprovalDetail
                  isAdmin={isAdmin}
                  sourceCustomerName={selected.customerName}
                  familyLinkAdminDetail={selected.familyLinkAdminDetail}
                />
              ) : selected.requestType === "update_family_relationship" ||
                selected.requestType === "unlink_family_customer" ? (
                <FamilyManagementApprovalDetail
                  isAdmin={isAdmin}
                  sourceCustomerName={selected.customerName}
                  familyManagementAdminDetail={selected.familyManagementAdminDetail}
                />
              ) : selected.requestType === "set_priority_customer" ||
                selected.requestType === "unset_priority_customer" ? (
                <PriorityCustomerApprovalDetail reason={selected.reason} />
              ) : (
                selected.payload && (
                  <div>
                    <dt className="text-[#6B7890]">{t("approvals.payloadDetails")}</dt>
                    <dd className="whitespace-pre-wrap font-mono text-xs">
                      {JSON.stringify(selected.payload, null, 2)}
                    </dd>
                  </div>
                )
              )}
              {selected.adminComment && (
                <div>
                  <dt className="text-[#6B7890]">{t("approvals.reviewComment")}</dt>
                  <dd className="whitespace-pre-wrap">{selected.adminComment}</dd>
                </div>
              )}
            </dl>

            {isAdmin && selected.status === "pending" && (
              <div className="mt-4">
                <Field>
                  <Label htmlFor="admin-comment">{t("approvals.adminCommentLabel")}</Label>
                  <Input
                    id="admin-comment"
                    value={adminComment}
                    onChange={(e) => setAdminComment(e.target.value)}
                    placeholder={t("approvals.adminCommentPlaceholder")}
                  />
                </Field>
                <div className="mt-4 flex justify-end gap-3">
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={submitting}
                    onClick={() => setSelectedId(null)}
                  >
                    {t("common.close")}
                  </Button>
                  <Button
                    type="button"
                    variant="danger"
                    disabled={submitting}
                    onClick={() => void handleReview("reject")}
                  >
                    {t("approvals.reject")}
                  </Button>
                  <Button
                    type="button"
                    disabled={submitting}
                    onClick={() => void handleReview("approve")}
                  >
                    {t("approvals.approve")}
                  </Button>
                </div>
              </div>
            )}

            {(!isAdmin || selected.status !== "pending") && (
              <div className="mt-4 flex justify-end">
                <Button type="button" variant="secondary" onClick={() => setSelectedId(null)}>
                  {t("common.close")}
                </Button>
              </div>
            )}
          </ModalPanel>
        </ModalOverlay>
      )}
    </div>
  );
}
