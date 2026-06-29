"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/card";
import { PageIntro } from "@/components/ui/page-intro";
import { useTranslation } from "@/i18n/provider";
import type { RecycleBinCustomerView } from "@/lib/recycle-bin/types";
import { formatHongKongDateTime } from "@/lib/timezone";

function formatContact(row: RecycleBinCustomerView): string {
  const parts = [row.phone, row.email].filter(Boolean);
  return parts.length > 0 ? parts.join(" / ") : "—";
}

function formatRemainingDays(
  row: RecycleBinCustomerView,
  t: (key: string, params?: Record<string, string>) => string,
): string {
  if (row.remaining_retention_days <= 0) {
    return t("recycleBin.pendingAutoPurge");
  }
  return t("recycleBin.remainingDays", {
    days: String(row.remaining_retention_days),
  });
}

export function RecycleBinClient() {
  const { t } = useTranslation();
  const [items, setItems] = useState<RecycleBinCustomerView[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/recycle-bin");
      const data = (await res.json()) as {
        items?: RecycleBinCustomerView[];
        error?: string;
      };
      if (!res.ok) {
        setMessage(data.error ?? t("common.loadFailed"));
        setItems([]);
        return;
      }
      setItems(data.items ?? []);
    } catch {
      setMessage(t("common.networkError"));
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial recycle bin fetch on mount
    void load();
  }, [load]);

  async function restoreCustomer(row: RecycleBinCustomerView) {
    if (!window.confirm(t("recycleBin.restoreConfirm"))) {
      return;
    }

    setRestoringId(row.id);
    setMessage(null);
    try {
      const res = await fetch(`/api/admin/recycle-bin/${row.id}/restore`, {
        method: "POST",
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setMessage(data.error ?? t("recycleBin.restoreFailed"));
        return;
      }
      setMessage(t("recycleBin.restoreSuccess"));
      await load();
    } catch {
      setMessage(t("common.networkError"));
    } finally {
      setRestoringId(null);
    }
  }

  async function permanentlyDeleteCustomer(row: RecycleBinCustomerView) {
    if (!window.confirm(t("recycleBin.permanentDeleteConfirm"))) {
      return;
    }

    setDeletingId(row.id);
    setMessage(null);
    try {
      const res = await fetch(
        `/api/admin/recycle-bin/${row.id}/permanent-delete`,
        { method: "POST" },
      );
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setMessage(data.error ?? t("recycleBin.permanentDeleteFailed"));
        return;
      }
      setMessage(t("recycleBin.permanentDeleteSuccess"));
      await load();
    } catch {
      setMessage(t("recycleBin.permanentDeleteFailed"));
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="space-y-6">
      <PageIntro
        title={t("recycleBin.pageTitle")}
        description={t("recycleBin.pageDescription")}
      />

      {message && (
        <div className="surface-card px-4 py-3 text-sm text-[#172033]">
          {message}
        </div>
      )}

      <div className="surface-card p-6">
        {loading ? (
          <p className="text-sm text-[#6B7890]">{t("common.loading")}</p>
        ) : items.length === 0 ? (
          <EmptyState message={t("recycleBin.empty")} />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead>
                <tr className="table-head border-b border-[#E3E8F0] text-[#6B7890]">
                  <th className="px-3 py-2">{t("recycleBin.colCustomerCode")}</th>
                  <th className="px-3 py-2">{t("recycleBin.colCustomerName")}</th>
                  <th className="px-3 py-2">{t("recycleBin.colContact")}</th>
                  <th className="px-3 py-2">{t("recycleBin.colOwner")}</th>
                  <th className="px-3 py-2">{t("recycleBin.colDeletedAt")}</th>
                  <th className="px-3 py-2">{t("recycleBin.colDeletedBy")}</th>
                  <th className="px-3 py-2">{t("recycleBin.colDeletedReason")}</th>
                  <th className="px-3 py-2">{t("recycleBin.colRemainingDays")}</th>
                  <th className="px-3 py-2">{t("common.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((row) => {
                  const rowBusy = restoringId === row.id || deletingId === row.id;
                  return (
                    <tr key={row.id} className="table-row border-b border-[#EEF3F8]">
                      <td className="px-3 py-2 font-mono text-xs text-[#6B7890]">
                        {row.customer_code ?? "—"}
                      </td>
                      <td className="px-3 py-2 font-medium text-[#172033]">
                        {row.customer_name}
                      </td>
                      <td className="px-3 py-2">{formatContact(row)}</td>
                      <td className="px-3 py-2">
                        {row.owner_name ?? t("recycleBin.noOwner")}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">
                        {formatHongKongDateTime(row.deleted_at)}
                      </td>
                      <td className="px-3 py-2">
                        {row.deleted_by_name ?? "—"}
                      </td>
                      <td className="max-w-xs truncate px-3 py-2">
                        {row.deleted_reason ?? "—"}
                      </td>
                      <td className="px-3 py-2">
                        {formatRemainingDays(row, t)}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-2">
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={rowBusy}
                            onClick={() => restoreCustomer(row)}
                          >
                            {restoringId === row.id
                              ? t("common.loading")
                              : t("recycleBin.restore")}
                          </Button>
                          <Button
                            size="sm"
                            variant="danger"
                            disabled={rowBusy}
                            onClick={() => permanentlyDeleteCustomer(row)}
                          >
                            {deletingId === row.id
                              ? t("common.loading")
                              : t("recycleBin.permanentDelete")}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
