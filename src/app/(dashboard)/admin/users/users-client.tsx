"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/form";
import { useTranslation } from "@/i18n/provider";
import type { AdminUserView } from "@/lib/users-admin/types";
import { DeleteStaffModal } from "@/components/users/delete-staff-modal";
import { formatHongKongDateTime } from "@/lib/timezone";

function isDeletedUser(user: AdminUserView): boolean {
  return user.status === "deleted" || user.deleted_at !== null;
}

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
  const [deleteTarget, setDeleteTarget] = useState<AdminUserView | null>(null);

  const { currentUsers, formerUsers, stats } = useMemo(() => {
    const current = users.filter((u) => !isDeletedUser(u));
    const former = users
      .filter((u) => isDeletedUser(u))
      .sort((a, b) => {
        const aTime = a.deleted_at ?? "";
        const bTime = b.deleted_at ?? "";
        return bTime.localeCompare(aTime);
      });
    const activeCount = current.filter((u) => u.status === "active").length;
    const adminCount = current.filter(
      (u) => u.role === "admin" && u.status === "active",
    ).length;
    const staffCount = current.filter(
      (u) => u.role === "staff" && u.status === "active",
    ).length;

    return {
      currentUsers: current,
      formerUsers: former,
      stats: {
        active: activeCount,
        deleted: former.length,
        admins: adminCount,
        staff: staffCount,
      },
    };
  }, [users]);

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
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial user list fetch on mount
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

  async function disableStaff(user: AdminUserView) {
    const res = await fetch(`/api/admin/users/${user.id}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "disabled" }),
    });
    const data = (await res.json()) as { error?: string };
    if (!res.ok) {
      setMessage(data.error ?? t("employees.operationFailed"));
      return;
    }
    setMessage(t("employees.accountDisabled"));
    await load();
  }

  async function enableStaff(user: AdminUserView) {
    const res = await fetch(`/api/admin/users/${user.id}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "active" }),
    });
    const data = (await res.json()) as { error?: string };
    if (!res.ok) {
      setMessage(data.error ?? t("employees.operationFailed"));
      return;
    }
    setMessage(t("employees.accountEnabled"));
    await load();
  }

  function openDeleteStaffModal(user: AdminUserView) {
    setMessage(null);
    setDeleteTarget(user);
  }

  function handleStaffDeleted(transferredCustomerCount: number) {
    setMessage(
      transferredCustomerCount > 0
        ? t("employees.staffDeletedWithCount", {
            count: String(transferredCustomerCount),
          })
        : t("employees.staffDeletedNoCount"),
    );
    void load();
  }

  function deleteStaff(user: AdminUserView) {
    openDeleteStaffModal(user);
  }

  function statusLabel(status: AdminUserView["status"]) {
    if (status === "active") return t("employees.statusNormal");
    if (status === "deleted") return t("employees.statusDeleted");
    return t("employees.statusDisabled");
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
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label={t("employees.statsActiveEmployees")}
          value={stats.active}
        />
        <StatCard
          label={t("employees.statsDeletedEmployees")}
          value={stats.deleted}
        />
        <StatCard label={t("employees.statsAdminCount")} value={stats.admins} />
        <StatCard label={t("employees.statsStaffCount")} value={stats.staff} />
      </div>

      <div className="surface-card p-6">
        <Button onClick={() => setShowCreate(true)}>
          {t("employees.createStaff")}
        </Button>
        {message && <p className="mt-3 text-sm text-[#172033]">{message}</p>}
      </div>

      {showCreate && (
        <div className="surface-card p-6">
          <h3 className="font-medium text-[#172033]">
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
        <div className="surface-card p-6">
          <h3 className="font-medium text-[#172033]">
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

      <div className="surface-card p-6">
        <h3 className="text-lg font-medium text-[#172033]">
          {t("employees.listTitle")}
        </h3>
        {loading ? (
          <p className="mt-4 text-sm text-[#6B7890]">{t("common.loading")}</p>
        ) : currentUsers.length === 0 ? (
          <p className="mt-4 text-sm text-[#6B7890]">{t("common.noData")}</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead>
                <tr className="table-head border-b border-[#E3E8F0] text-[#6B7890]">
                  <th className="px-3 py-2">{t("common.name")}</th>
                  <th className="px-3 py-2">{t("common.email")}</th>
                  <th className="px-3 py-2">{t("common.role")}</th>
                  <th className="px-3 py-2">{t("common.status")}</th>
                  <th className="px-3 py-2">{t("employees.failedAttempts")}</th>
                  <th className="px-3 py-2">{t("employees.lockStatus")}</th>
                  <th className="px-3 py-2">{t("employees.lastFailedLogin")}</th>
                  <th className="px-3 py-2">{t("employees.lockedAt")}</th>
                  <th className="px-3 py-2">{t("employees.lockReason")}</th>
                  <th className="px-3 py-2">{t("employees.lastLogin")}</th>
                  <th className="px-3 py-2">{t("common.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {currentUsers.map((u) => (
                  <tr key={u.id} className="table-row border-b border-[#EEF3F8]">
                    <td className="px-3 py-2">{u.name}</td>
                    <td className="px-3 py-2">{u.email}</td>
                    <td className="px-3 py-2">
                      {u.role === "admin"
                        ? t("employees.adminRole")
                        : t("employees.staffRole")}
                    </td>
                    <td className="px-3 py-2">{statusLabel(u.status)}</td>
                    <td className="px-3 py-2">{u.failed_login_count}</td>
                    <td className="px-3 py-2">
                      {u.lockout_exempt
                        ? t("employees.lockoutExempt")
                        : u.is_locked
                          ? t("employees.lockStatusLocked")
                          : t("employees.lockStatusActive")}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {formatHongKongDateTime(u.last_failed_login_at)}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {formatHongKongDateTime(u.locked_at)}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {u.lock_reason
                        ? t("employees.lockReasonTooManyAttempts")
                        : "—"}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {formatHongKongDateTime(u.last_login_at)}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        {u.role === "staff" && u.status === "active" && (
                          <Button
                            size="sm"
                            variant="secondary"
                            title={t("employees.disableStaffHint")}
                            onClick={() => disableStaff(u)}
                          >
                            {t("employees.disableStaff")}
                          </Button>
                        )}
                        {u.role === "staff" && u.status === "disabled" && (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => enableStaff(u)}
                          >
                            {t("employees.enableAccount")}
                          </Button>
                        )}
                        {u.role === "staff" && (
                          <Button
                            size="sm"
                            variant="secondary"
                            title={t("employees.deleteStaffHint")}
                            onClick={() => deleteStaff(u)}
                          >
                            {t("employees.deleteStaff")}
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => setResetUserId(u.id)}
                        >
                          {t("employees.resetPassword")}
                        </Button>
                        {(u.is_locked ||
                          (!u.lockout_exempt && u.failed_login_count > 0)) && (
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

      {deleteTarget && (
        <DeleteStaffModal
          user={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onDeleted={handleStaffDeleted}
        />
      )}

      <div className="surface-card p-6">
        <h3 className="text-lg font-medium text-[#172033]">
          {t("employees.formerEmployeesTitle")}
        </h3>
        <p className="mt-2 text-sm text-[#6B7890]">
          {t("employees.formerEmployeesDescription")}
        </p>
        {loading ? (
          <p className="mt-4 text-sm text-[#6B7890]">{t("common.loading")}</p>
        ) : formerUsers.length === 0 ? (
          <p className="mt-4 text-sm text-[#6B7890]">{t("common.noData")}</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead>
                <tr className="table-head border-b border-[#E3E8F0] text-[#6B7890]">
                  <th className="px-3 py-2">{t("common.name")}</th>
                  <th className="px-3 py-2">{t("common.email")}</th>
                  <th className="px-3 py-2">{t("common.role")}</th>
                  <th className="px-3 py-2">{t("common.status")}</th>
                  <th className="px-3 py-2">{t("employees.deletedAt")}</th>
                  <th className="px-3 py-2">{t("employees.deletedBy")}</th>
                  <th className="px-3 py-2">
                    {t("employees.colTransferredCustomers")}
                  </th>
                  <th className="px-3 py-2">
                    {t("employees.transferredToAdmin")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {formerUsers.map((u) => (
                  <tr key={u.id} className="table-row border-b border-[#EEF3F8]">
                    <td className="px-3 py-2">{u.name}</td>
                    <td className="px-3 py-2">{u.email}</td>
                    <td className="px-3 py-2">
                      {u.role === "admin"
                        ? t("employees.adminRole")
                        : t("employees.staffRole")}
                    </td>
                    <td className="px-3 py-2">
                      {t("employees.statusDeleted")}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {formatHongKongDateTime(u.deleted_at)}
                    </td>
                    <td className="px-3 py-2">
                      {u.deleted_by_name ?? "—"}
                    </td>
                    <td className="px-3 py-2">
                      {u.transferred_customer_count ?? 0}
                    </td>
                    <td className="px-3 py-2">
                      {u.transferred_to_admin_name ??
                        t("employees.customerTransferredToAdmin")}
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

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="surface-muted px-4 py-3">
      <p className="text-xs font-medium text-[#6B7890]">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-[#172033]">{value}</p>
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
