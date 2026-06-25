"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/form";
import { useTranslation } from "@/i18n/provider";
import type { AdminUserView } from "@/lib/users-admin/types";

export function UsersClient() {
  const { t } = useTranslation();
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
      const data = (await res.json()) as {
        items?: AdminUserView[];
        error?: string;
      };
      if (!res.ok) {
        setMessage(data.error ?? t("common.loadFailed"));
        return;
      }
      setUsers(data.items ?? []);
    } catch {
      setMessage(t("common.networkError"));
    } finally {
      setLoading(false);
    }
  }, [t]);

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
      setMessage(data.error ?? t("employees.createFailed"));
      return;
    }
    setShowCreate(false);
    setCreateForm({ name: "", email: "", temporaryPassword: "" });
    setMessage(t("employees.staffCreated"));
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
      setMessage(data.error ?? t("employees.operationFailed"));
      return;
    }
    setMessage(
      next === "active"
        ? t("employees.accountEnabled")
        : t("employees.accountDisabled"),
    );
    await load();
  }

  async function unlockUser(userId: string) {
    const res = await fetch(`/api/admin/users/${userId}/unlock`, {
      method: "POST",
    });
    const data = (await res.json()) as { error?: string };
    if (!res.ok) {
      setMessage(data.error ?? t("employees.operationFailed"));
      return;
    }
    setMessage(t("employees.accountUnlocked"));
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
      setMessage(data.error ?? t("employees.operationFailed"));
      return;
    }
    setResetUserId(null);
    setNewPassword("");
    setMessage(t("employees.passwordResetRelogin"));
    await load();
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <Button onClick={() => setShowCreate(true)}>
          {t("employees.createStaff")}
        </Button>
        {message && <p className="mt-3 text-sm text-slate-700">{message}</p>}
      </div>

      {showCreate && (
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h3 className="font-medium text-slate-900">
            {t("employees.newStaffAccountTitle")}
          </h3>
          <div className="mt-4 grid max-w-md gap-3">
            <Field label={t("employees.staffName")} id="name">
              <Input
                id="name"
                value={createForm.name}
                onChange={(e) =>
                  setCreateForm((f) => ({ ...f, name: e.target.value }))
                }
              />
            </Field>
            <Field label={t("employees.staffEmail")} id="email">
              <Input
                id="email"
                type="email"
                value={createForm.email}
                onChange={(e) =>
                  setCreateForm((f) => ({ ...f, email: e.target.value }))
                }
              />
            </Field>
            <Field label={t("employees.temporaryPassword")} id="temp-pw">
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
              <Button onClick={createStaff}>{t("common.add")}</Button>
              <Button variant="secondary" onClick={() => setShowCreate(false)}>
                {t("common.cancel")}
              </Button>
            </div>
          </div>
        </div>
      )}

      {resetUserId && (
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h3 className="font-medium text-slate-900">
            {t("employees.resetPassword")}
          </h3>
          <div className="mt-4 max-w-md">
            <Field label={t("employees.newPassword")} id="new-pw">
              <Input
                id="new-pw"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
            </Field>
            <div className="mt-3 flex gap-2">
              <Button onClick={submitResetPassword}>
                {t("employees.confirmReset")}
              </Button>
              <Button variant="secondary" onClick={() => setResetUserId(null)}>
                {t("common.cancel")}
              </Button>
            </div>
          </div>
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="text-lg font-medium text-slate-900">
          {t("employees.listTitle")}
        </h3>
        {loading ? (
          <p className="mt-4 text-sm text-slate-500">{t("common.loading")}</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="px-3 py-2">{t("common.name")}</th>
                  <th className="px-3 py-2">{t("common.email")}</th>
                  <th className="px-3 py-2">{t("common.role")}</th>
                  <th className="px-3 py-2">{t("common.status")}</th>
                  <th className="px-3 py-2">{t("employees.failedAttempts")}</th>
                  <th className="px-3 py-2">{t("employees.lockedUntil")}</th>
                  <th className="px-3 py-2">{t("employees.lastLogin")}</th>
                  <th className="px-3 py-2">{t("common.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="border-b border-slate-100">
                    <td className="px-3 py-2">{u.name}</td>
                    <td className="px-3 py-2">{u.email}</td>
                    <td className="px-3 py-2">
                      {u.role === "admin"
                        ? t("employees.adminRole")
                        : t("employees.staffRole")}
                    </td>
                    <td className="px-3 py-2">
                      {u.status === "active"
                        ? t("employees.statusNormal")
                        : t("employees.statusDisabled")}
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
                            {u.status === "active"
                              ? t("employees.disableAccount")
                              : t("employees.enableAccount")}
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => setResetUserId(u.id)}
                        >
                          {t("employees.resetPassword")}
                        </Button>
                        {(u.failed_login_count > 0 || u.locked_until) && (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => unlockUser(u.id)}
                          >
                            {t("employees.unlockAccount")}
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
