"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/form";
import type { LoginLogView } from "@/lib/users-admin/types";

export function LoginLogsClient() {
  const [items, setItems] = useState<LoginLogView[]>([]);
  const [email, setEmail] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (email.trim()) params.set("email", email.trim());
    if (success) params.set("success", success);
    const res = await fetch(`/api/admin/login-logs?${params}`);
    const data = (await res.json()) as { items?: LoginLogView[] };
    setItems(data.items ?? []);
    setLoading(false);
  }, [email, success]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="surface-card space-y-4 p-6">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <Label htmlFor="filter-email">邮箱筛选</Label>
          <Input
            id="filter-email"
            className="mt-1 w-48"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="filter-success">结果</Label>
          <Select
            id="filter-success"
            className="mt-1 w-32"
            value={success}
            onChange={(e) => setSuccess(e.target.value)}
          >
            <option value="">全部</option>
            <option value="true">成功</option>
            <option value="false">失败</option>
          </Select>
        </div>
        <Button variant="secondary" onClick={load}>
          筛选
        </Button>
      </div>

      {loading ? (
        <p className="text-sm text-[#6B7890]">加载中…</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead>
              <tr className="table-head border-b border-[#E3E8F0] text-[#6B7890]">
                <th className="px-3 py-2">邮箱</th>
                <th className="px-3 py-2">结果</th>
                <th className="px-3 py-2">失败原因</th>
                <th className="px-3 py-2">IP</th>
                <th className="px-3 py-2">设备</th>
                <th className="px-3 py-2">时间</th>
              </tr>
            </thead>
            <tbody>
              {items.map((row) => (
                <tr key={row.id} className="table-row border-b border-[#EEF3F8]">
                  <td className="px-3 py-2">{row.email}</td>
                  <td className="px-3 py-2">
                    {row.success ? (
                      <span className="text-green-700">成功</span>
                    ) : (
                      <span className="text-red-600">失败</span>
                    )}
                  </td>
                  <td className="px-3 py-2">{row.failure_reason ?? "—"}</td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {row.ip_address ?? "—"}
                  </td>
                  <td className="max-w-xs truncate px-3 py-2 text-xs">
                    {row.user_agent ?? "—"}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {row.created_at.slice(0, 19).replace("T", " ")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
