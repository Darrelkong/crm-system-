"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/form";
import type { DeviceListItem } from "@/lib/devices/types";
import { formatHongKongDateTime } from "@/lib/timezone";

type UserSummary = {
  approved_count: number;
  limit: number;
};

const STATUS_LABELS: Record<DeviceListItem["status"], string> = {
  pending: "待審核",
  approved: "已批准",
  rejected: "已拒絕",
  revoked: "已撤銷",
};

const STATUS_CLASS: Record<DeviceListItem["status"], string> = {
  pending: "text-amber-700",
  approved: "text-green-700",
  rejected: "text-red-600",
  revoked: "text-[#6B7890]",
};

export function DevicesClient() {
  const [items, setItems] = useState<DeviceListItem[]>([]);
  const [userSummaries, setUserSummaries] = useState<
    Record<string, UserSummary>
  >({});
  const [status, setStatus] = useState("");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(true);
  const [actionId, setActionId] = useState<string | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    if (email.trim()) params.set("email", email.trim());
    const res = await fetch(`/api/admin/devices?${params}`);
    const data = (await res.json()) as {
      items?: DeviceListItem[];
      userSummaries?: Record<string, UserSummary>;
      error?: string;
    };
    if (!res.ok) {
      setError(data.error ?? "載入失敗");
      setItems([]);
      setUserSummaries({});
      setLoading(false);
      return;
    }
    setItems(data.items ?? []);
    setUserSummaries(data.userSummaries ?? {});
    setLoading(false);
  }, [email, status]);

  useEffect(() => {
    void load();
  }, [load]);

  const pendingCount = useMemo(
    () => items.filter((item) => item.status === "pending").length,
    [items],
  );

  async function runAction(
    deviceId: string,
    action: "approve" | "reject" | "revoke",
    confirmMessage?: string,
  ) {
    if (confirmMessage && !window.confirm(confirmMessage)) {
      return;
    }
    setActionId(deviceId);
    setError("");
    try {
      const res = await fetch(`/api/admin/devices/${deviceId}/${action}`, {
        method: "POST",
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? "操作失敗");
        return;
      }
      await load();
    } finally {
      setActionId(null);
    }
  }

  function approveDevice(item: DeviceListItem) {
    const summary = userSummaries[item.user_id];
    const atLimit =
      summary != null && summary.approved_count >= summary.limit;
    const message = atLimit
      ? `該員工已達設備上限（${summary.approved_count} / ${summary.limit}）。請先撤銷舊設備後再批准。仍要嘗試批准？`
      : `批准 ${item.user_display_name} 的設備「${item.device_name ?? item.user_agent_summary ?? "未知"}」？`;
    void runAction(item.id, "approve", message);
  }

  return (
    <div className="surface-card space-y-4 p-6">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <Label htmlFor="filter-email">員工郵箱</Label>
          <Input
            id="filter-email"
            className="mt-1 w-56"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="filter-status">狀態</Label>
          <Select
            id="filter-status"
            className="mt-1 w-36"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="">全部</option>
            <option value="pending">待審核</option>
            <option value="approved">已批准</option>
            <option value="rejected">已拒絕</option>
            <option value="revoked">已撤銷</option>
          </Select>
        </div>
        <Button variant="secondary" onClick={() => void load()}>
          篩選
        </Button>
        {pendingCount > 0 && (
          <span className="text-sm text-amber-700">
            待審核：{pendingCount} 台
          </span>
        )}
      </div>

      {error ? (
        <p className="text-sm text-red-600" role="alert">
          {error}
        </p>
      ) : null}

      {loading ? (
        <p className="text-sm text-[#6B7890]">載入中…</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead>
              <tr className="table-head border-b border-[#E3E8F0] text-[#6B7890]">
                <th className="px-3 py-2">員工</th>
                <th className="px-3 py-2">設備</th>
                <th className="px-3 py-2">瀏覽器 / 系統</th>
                <th className="px-3 py-2">最近 IP</th>
                <th className="px-3 py-2">狀態</th>
                <th className="px-3 py-2">已授權數</th>
                <th className="px-3 py-2">建立時間</th>
                <th className="px-3 py-2">最後登入</th>
                <th className="px-3 py-2">批准人</th>
                <th className="px-3 py-2">操作</th>
              </tr>
            </thead>
            <tbody>
              {items.map((row) => {
                const summary = userSummaries[row.user_id];
                const deviceLabel =
                  row.device_name ?? row.user_agent_summary ?? "未知設備";
                return (
                  <tr
                    key={row.id}
                    className="table-row border-b border-[#EEF3F8]"
                  >
                    <td className="px-3 py-2">
                      <div className="font-medium">{row.user_display_name}</div>
                      <div className="text-xs text-[#6B7890]">
                        {row.user_email}
                      </div>
                    </td>
                    <td className="px-3 py-2">{deviceLabel}</td>
                    <td className="max-w-xs truncate px-3 py-2 text-xs">
                      {row.user_agent_summary ?? "—"}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {row.last_seen_ip ?? row.ip_address ?? "—"}
                    </td>
                    <td className={`px-3 py-2 ${STATUS_CLASS[row.status]}`}>
                      {STATUS_LABELS[row.status]}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {summary
                        ? `${summary.approved_count} / ${summary.limit}`
                        : "—"}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {formatHongKongDateTime(row.created_at)}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {row.last_seen_at
                        ? formatHongKongDateTime(row.last_seen_at)
                        : "—"}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {row.approved_by_name ?? "—"}
                      {row.approved_at ? (
                        <div className="font-mono text-[#6B7890]">
                          {formatHongKongDateTime(row.approved_at)}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-2">
                        {row.status === "pending" ? (
                          <>
                            <Button
                              size="sm"
                              disabled={actionId === row.id}
                              onClick={() => approveDevice(row)}
                            >
                              批准
                            </Button>
                            <Button
                              size="sm"
                              variant="secondary"
                              disabled={actionId === row.id}
                              onClick={() =>
                                void runAction(
                                  row.id,
                                  "reject",
                                  `拒絕此設備授權申請？`,
                                )
                              }
                            >
                              拒絕
                            </Button>
                          </>
                        ) : null}
                        {row.status === "approved" ? (
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={actionId === row.id}
                            onClick={() =>
                              void runAction(
                                row.id,
                                "revoke",
                                `撤銷此設備授權？該設備上的登入將立即失效。`,
                              )
                            }
                          >
                            撤銷
                          </Button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {items.length === 0 ? (
            <p className="px-3 py-6 text-sm text-[#6B7890]">暫無設備記錄</p>
          ) : null}
        </div>
      )}
    </div>
  );
}
