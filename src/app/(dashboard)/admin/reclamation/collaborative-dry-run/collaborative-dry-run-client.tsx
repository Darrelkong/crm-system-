"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, EmptyState } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageIntro } from "@/components/ui/page-intro";
import type { CollaborativeDissolutionDryRunResult } from "@/lib/reclamation/collaborative-dry-run";
import { formatHongKongDateTime } from "@/lib/timezone";

function formatIso(value: string | null): string {
  if (!value) return "—";
  return formatHongKongDateTime(value);
}

function SummaryCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="surface-card p-5">
      <p className="text-xs font-medium uppercase tracking-wide text-[#6B7890]">
        {label}
      </p>
      <div className="mt-2 text-2xl font-semibold text-[#172033]">{value}</div>
      {hint ? (
        <p className="mt-2 text-xs leading-relaxed text-[#6B7890]">{hint}</p>
      ) : null}
    </div>
  );
}

export function CollaborativeDryRunClient() {
  const [data, setData] = useState<CollaborativeDissolutionDryRunResult | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError(null);

    try {
      const res = await fetch("/api/admin/reclamation/collaborative-dry-run");
      const body = (await res.json()) as CollaborativeDissolutionDryRunResult & {
        error?: string;
        message?: string;
      };

      if (!res.ok) {
        setData(null);
        setError(body.message ?? body.error ?? "無法載入 dry-run 報告");
        return;
      }

      setData(body);
    } catch {
      setData(null);
      setError("網路錯誤，請稍後再試");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const candidates = data?.candidates ?? [];

  return (
    <div className="space-y-6">
      <PageIntro
        title="共同負責自動解散 Dry-run"
        description="此頁面只顯示如果未來啟用 90 天共同負責自動解散，可能受影響的客戶；目前不會修改任何資料。"
        action={
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={loading || refreshing}
            onClick={() => void load(true)}
          >
            {refreshing ? "重新整理中…" : "重新整理"}
          </Button>
        }
      />

      {error ? (
        <div className="surface-card border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="surface-card p-6">
          <p className="text-sm text-[#6B7890]">載入中…</p>
        </div>
      ) : data ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <SummaryCard
              label="Feature flag 狀態"
              value={
                data.enabled ? (
                  <Badge variant="success">已啟用</Badge>
                ) : (
                  <Badge variant="default">未啟用</Badge>
                )
              }
              hint="collaborative_dissolution_enabled"
            />
            <SummaryCard
              label="Threshold days"
              value={data.thresholdDays}
              hint="未有效跟進天數門檻"
            />
            <SummaryCard
              label="Total candidates"
              value={data.totalCandidates}
              hint="符合條件的共同負責客戶數"
            />
            <SummaryCard
              label="Dry-run only"
              value={<Badge variant="warning">僅預覽</Badge>}
              hint="此頁面與 API 均不會修改任何客戶或 assignee 資料"
            />
          </div>

          <div className="surface-card p-6">
            {candidates.length === 0 ? (
              <EmptyState message="目前沒有符合 90 天門檻的共同負責候選客戶。" />
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-[#E3E8F0] text-xs uppercase tracking-wide text-[#6B7890]">
                      <th className="px-3 py-2 font-medium">customerCode</th>
                      <th className="px-3 py-2 font-medium">customerName</th>
                      <th className="px-3 py-2 font-medium">ownerId</th>
                      <th className="px-3 py-2 font-medium">createdBy</th>
                      <th className="px-3 py-2 font-medium">
                        lastValidFollowUpAt
                      </th>
                      <th className="px-3 py-2 font-medium">createdAt</th>
                      <th className="px-3 py-2 font-medium">
                        daysWithoutValidFollowUp
                      </th>
                      <th className="px-3 py-2 font-medium">
                        collaboratorCount
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {candidates.map((row) => (
                      <tr
                        key={row.customerId}
                        className="border-b border-[#EEF2F7] last:border-0"
                      >
                        <td className="px-3 py-3 font-mono text-xs text-[#172033]">
                          {row.customerCode ?? "—"}
                        </td>
                        <td className="px-3 py-3 text-[#172033]">
                          {row.customerName}
                        </td>
                        <td className="px-3 py-3 font-mono text-xs text-[#6B7890]">
                          {row.ownerId ?? "—"}
                        </td>
                        <td className="px-3 py-3 font-mono text-xs text-[#6B7890]">
                          {row.createdBy}
                        </td>
                        <td className="px-3 py-3 text-[#172033]">
                          {formatIso(row.lastValidFollowUpAt)}
                        </td>
                        <td className="px-3 py-3 text-[#172033]">
                          {formatIso(row.createdAt)}
                        </td>
                        <td className="px-3 py-3 font-medium text-[#172033]">
                          {row.daysWithoutValidFollowUp}
                        </td>
                        <td className="px-3 py-3 text-[#172033]">
                          {row.collaboratorCount}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}
