"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/form";
import type { AdminUserView } from "@/lib/users-admin/types";

export function UsersClient() {
  const [users, setUsers] = useState<AdminUserView[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [resetUserId, setResetUserId] = useState<string | null>(null);
  const [createForm, setCreateForm] = useState({
    name: "",
    email: "",
    temporaryPassword: "",
  });
  const [newPassword, setNewPassword] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/users");
      const data = (await res.json()) as { items?: AdminUserView[]; error?: string };
      if (!res.ok) {
        setMessage(data.error ?? "加载失败");
        return;
      }
      setUsers(data.items ?? []);
    } catch {
      setMessage("网络错误");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function createStaff() {
    setMessage(null);
    const res = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...createForm, role: "staff" }),
    });
    const data = (await res.json()) as { error?: string };
    if (!res.ok) {
      setMessage(data.error ?? "创建失败");
      return;
    }
    setShowCreate(false);
    setCreateForm({ name: "", email: "", temporaryPassword: "" });
    setMessage("员工账号已创建");
    await load();
  }

  async function toggleStatus(user: AdminUserView) {
    const next = user.status === "active" ? "disabled" : "active";
    const res = await fetch(`/api/admin/users/${user.id}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: next }),
    });
    const data = (await res.json()) as { error?: string };
    if (!res.ok) {
      setMessage(data.error ?? "操作失败");
      return;
    }
    setMessage(next === "active" ? "已启用" : "已停用");
    await load();
  }

  async function unlockUser(userId: string) {
    const res = await fetch(`/api/admin/users/${userId}/unlock`, {
      method: "POST",
    });
    const data = (await res.json()) as { error?: string };
    if (!res.ok) {
      setMessage(data.error ?? "解锁失败");
      return;
    }
    setMessage("账号已解锁");
    await load();
  }

  async function submitResetPassword() {
    if (!resetUserId) return;
    const res = await fetch(`/api/admin/users/${resetUserId}/reset-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ newPassword }),
    });
    const data = (await res.json()) as { error?: string };
    if (!res.ok) {
      setMessage(data.error ?? "重置失败");
      return;
    }
    setResetUserId(null);
    setNewPassword("");
    setMessage("密码已重置，该用户需重新登录");
    await load();
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <Button onClick={() => setShowCreate(true)}>创建员工账号</Button>
        {message && <p className="mt-3 text-sm text-slate-700">{message}</p>}
      </div>

      {showCreate && (
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h3 className="font-medium text-slate-900">新建 Staff 账号</h3>
          <div className="mt-4 grid max-w-md gap-3">
            <Field label="姓名" id="name">
              <Input
                id="name"
                value={createForm.name}
                onChange={(e) =>
                  setCreateForm((f) => ({ ...f, name: e.target.value }))
                }
              />
            </Field>
            <Field label="邮箱" id="email">
              <Input
                id="email"
                type="email"
                value={createForm.email}
                onChange={(e) =>
                  setCreateForm((f) => ({ ...f, email: e.target.value }))
                }
              />
            </Field>
            <Field label="临时密码" id="temp-pw">
              <Input
                id="temp-pw"
                type="password"
                value={createForm.temporaryPassword}
                onChange={(e) =>
                  setCreateForm((f) => ({
                    ...f,
                    temporaryPassword: e.target.value,
                  }))
                }
              />
            </Field>
            <div className="flex gap-2">
              <Button onClick={createStaff}>创建</Button>
              <Button variant="secondary" onClick={() => setShowCreate(false)}>
                取消
              </Button>
            </div>
          </div>
        </div>
      )}

      {resetUserId && (
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h3 className="font-medium text-slate-900">重置密码</h3>
          <div className="mt-4 max-w-md">
            <Field label="新密码" id="new-pw">
              <Input
                id="new-pw"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
            </Field>
            <div className="mt-3 flex gap-2">
              <Button onClick={submitResetPassword}>确认重置</Button>
              <Button variant="secondary" onClick={() => setResetUserId(null)}>
                取消
              </Button>
            </div>
          </div>
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="text-lg font-medium text-slate-900">用户列表</h3>
        {loading ? (
          <p className="mt-4 text-sm text-slate-500">加载中…</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="px-3 py-2">姓名</th>
                  <th className="px-3 py-2">邮箱</th>
                  <th className="px-3 py-2">角色</th>
                  <th className="px-3 py-2">状态</th>
                  <th className="px-3 py-2">失败次数</th>
                  <th className="px-3 py-2">锁定至</th>
                  <th className="px-3 py-2">最近登录</th>
                  <th className="px-3 py-2">操作</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="border-b border-slate-100">
                    <td className="px-3 py-2">{u.name}</td>
                    <td className="px-3 py-2">{u.email}</td>
                    <td className="px-3 py-2">{u.role}</td>
                    <td className="px-3 py-2">
                      {u.status === "active" ? "正常" : "已停用"}
                    </td>
                    <td className="px-3 py-2">{u.failed_login_count}</td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {u.locked_until?.slice(0, 16).replace("T", " ") ?? "—"}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {u.last_login_at?.slice(0, 16).replace("T", " ") ?? "—"}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        {u.role === "staff" && (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => toggleStatus(u)}
                          >
                            {u.status === "active" ? "停用" : "启用"}
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => setResetUserId(u.id)}
                        >
                          重置密码
                        </Button>
                        {(u.failed_login_count > 0 || u.locked_until) && (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => unlockUser(u.id)}
                          >
                            解锁
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  id,
  children,
}: {
  label: string;
  id: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <div className="mt-1">{children}</div>
    </div>
  );
}
