"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronRight, Loader2, ShieldCheck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/form";
import { useTranslation } from "@/i18n/provider";
import type { AdminUserView } from "@/lib/users-admin/types";
import type { DeviceListItem } from "@/lib/devices/types";
import {
  getDeviceDisplayLabel,
  getDeviceNetworkAddress,
} from "@/lib/devices/display";
import { sortReplacementCandidates } from "@/lib/devices/replacement-selection";
import { DeleteStaffModal } from "@/components/users/delete-staff-modal";
import { formatHongKongDateTime } from "@/lib/timezone";
import {
  computeAdminUserStats,
  isDeletedAdminUser,
} from "@/lib/users-admin/admin-user-stats";

function formatOptionalCount(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : String(value);
}

type DeviceSummary = {
  approved_count: number;
  limit: number;
};

type ReplacementModalState = {
  pendingDevice: DeviceListItem;
  candidates: DeviceListItem[];
  selectedReplacementId: string | null;
  limit: number;
};

export function UsersClient() {
  const { t } = useTranslation();
  const router = useRouter();
  const searchParams = useSearchParams();
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
  const [selectedUser, setSelectedUser] = useState<AdminUserView | null>(null);
  const [selectedDevices, setSelectedDevices] = useState<DeviceListItem[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [bindingResetting, setBindingResetting] = useState(false);
  const [activeView, setActiveView] = useState<"members" | "devices">(
    () => (searchParams.get("view") === "devices" ? "devices" : "members"),
  );
  const [pendingDevices, setPendingDevices] = useState<DeviceListItem[]>([]);
  const [pendingDevicesLoading, setPendingDevicesLoading] = useState(false);
  const [pendingDeviceActionId, setPendingDeviceActionId] = useState<
    string | null
  >(null);
  const [pendingDeviceSummaries, setPendingDeviceSummaries] = useState<
    Record<string, DeviceSummary>
  >({});
  const [selectedDeviceSummary, setSelectedDeviceSummary] =
    useState<DeviceSummary | null>(null);
  const [replacementModal, setReplacementModal] =
    useState<ReplacementModalState | null>(null);
  const [replacementLoading, setReplacementLoading] = useState(false);
  const [replacementSubmitting, setReplacementSubmitting] = useState(false);

  const { currentUsers, formerUsers, stats } = useMemo(() => {
    const current = users.filter((u) => !isDeletedAdminUser(u));
    const former = users
      .filter((u) => isDeletedAdminUser(u))
      .sort((a, b) => {
        const aTime = a.deleted_at ?? "";
        const bTime = b.deleted_at ?? "";
        return bTime.localeCompare(aTime);
      });

    return {
      currentUsers: current,
      formerUsers: former,
      stats: computeAdminUserStats(users),
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

  const loadPendingDevices = useCallback(async () => {
    setPendingDevicesLoading(true);
    try {
      const response = await fetch("/api/admin/devices?status=pending");
      const data = (await response.json()) as {
        items?: DeviceListItem[];
        userSummaries?: Record<string, DeviceSummary>;
        error?: string;
      };
      if (!response.ok) {
        setMessage(data.error ?? t("common.loadFailed"));
        setPendingDevices([]);
        setPendingDeviceSummaries({});
        return;
      }
      setPendingDevices(data.items ?? []);
      setPendingDeviceSummaries(data.userSummaries ?? {});
    } catch {
      setMessage(t("common.networkError"));
      setPendingDevices([]);
      setPendingDeviceSummaries({});
    } finally {
      setPendingDevicesLoading(false);
    }
  }, [t]);

  function selectView(view: "members" | "devices") {
    setActiveView(view);
    router.replace(
      view === "devices"
        ? "/admin/users?view=devices&status=pending"
        : "/admin/users",
    );
  }

  async function openMemberDetail(user: AdminUserView) {
    setSelectedUser(user);
    setSelectedDevices([]);
    setSelectedDeviceSummary(null);
    setDetailLoading(true);
    try {
      const response = await fetch(
        `/api/admin/devices?userId=${encodeURIComponent(user.id)}`,
      );
      const data = (await response.json()) as {
        items?: DeviceListItem[];
        userSummaries?: Record<string, DeviceSummary>;
      };
      setSelectedDevices(response.ok ? data.items ?? [] : []);
      const userSummary = data.userSummaries?.[user.id] ?? null;
      setSelectedDeviceSummary(userSummary);
    } finally {
      setDetailLoading(false);
    }
  }

  async function resetAccessBinding() {
    if (!selectedUser || selectedUser.role !== "staff") return;
    if (
      !window.confirm(
        "解除 Access 绑定？解除后，该成员下次使用新的私人 Access 邮箱完成 Cloudflare 验证并成功登录 CRM 时，会自动建立新的绑定。",
      )
    ) {
      return;
    }
    setBindingResetting(true);
    try {
      const response = await fetch(
        `/api/admin/users/${encodeURIComponent(selectedUser.id)}/access-binding`,
        { method: "DELETE" },
      );
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        setMessage(data.error ?? t("employees.operationFailed"));
        return;
      }
      setMessage("Access 绑定已解除，目标成员的现有 Session 已撤销。");
      setSelectedUser((current) =>
        current ? { ...current, cloudflare_access_email: null } : current,
      );
      await load();
    } finally {
      setBindingResetting(false);
    }
  }

  async function runMemberDeviceAction(
    deviceId: string,
    action: "approve" | "reject" | "revoke",
  ) {
    const response = await fetch(`/api/admin/devices/${deviceId}/${action}`, {
      method: "POST",
    });
    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      setMessage(data.error ?? t("employees.operationFailed"));
      return;
    }
    if (selectedUser) {
      await openMemberDetail(selectedUser);
    }
  }

  async function openReplacementModal(pendingDevice: DeviceListItem) {
    const knownSummary =
      pendingDeviceSummaries[pendingDevice.user_id] ?? selectedDeviceSummary;
    setReplacementModal({
      pendingDevice,
      candidates: [],
      selectedReplacementId: null,
      limit: knownSummary?.limit ?? 0,
    });
    setReplacementLoading(true);
    try {
      const response = await fetch(
        `/api/admin/devices?userId=${encodeURIComponent(pendingDevice.user_id)}`,
      );
      const data = (await response.json().catch(() => ({}))) as {
        items?: DeviceListItem[];
        userSummaries?: Record<string, DeviceSummary>;
        error?: string;
      };
      if (!response.ok) {
        setReplacementModal(null);
        setMessage(data.error ?? t("employees.operationFailed"));
        return;
      }
      const candidates = sortReplacementCandidates(
        (data.items ?? []).filter((item) => item.status === "approved"),
      );
      if (candidates.length === 0) {
        setReplacementModal(null);
        setMessage("当前没有可替换的已授权设备，请重新载入。");
        return;
      }
      setReplacementModal({
        pendingDevice,
        candidates,
        selectedReplacementId: candidates[0]?.id ?? null,
        limit:
          data.userSummaries?.[pendingDevice.user_id]?.limit ??
          knownSummary?.limit ??
          candidates.length,
      });
    } finally {
      setReplacementLoading(false);
    }
  }

  async function submitReplacement() {
    if (!replacementModal?.selectedReplacementId) return;
    setReplacementSubmitting(true);
    try {
      const response = await fetch(
        `/api/admin/devices/${encodeURIComponent(
          replacementModal.pendingDevice.id,
        )}/approve-and-replace`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            replacementDeviceId: replacementModal.selectedReplacementId,
          }),
        },
      );
      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!response.ok) {
        setMessage(data.error ?? "设备状态已变化，请重新载入后再试。");
        setReplacementModal(null);
        await Promise.all([loadPendingDevices(), load()]);
        return;
      }
      setMessage("新设备已批准，所选旧设备已撤销授权。");
      setReplacementModal(null);
      await Promise.all([loadPendingDevices(), load()]);
      if (selectedUser) {
        await openMemberDetail(selectedUser);
      }
    } finally {
      setReplacementSubmitting(false);
    }
  }

  async function runPendingDeviceAction(
    deviceId: string,
    action: "approve" | "reject",
  ) {
    const device = pendingDevices.find((item) => item.id === deviceId);
    if (
      action === "reject" &&
      !window.confirm("拒绝此设备授权申请？")
    ) {
      return;
    }
    if (
      action === "approve" &&
      !window.confirm(
        `批准 ${device?.user_display_name ?? "该成员"} 的设备「${
          device ? getDeviceDisplayLabel(device) : "未知设备"
        }」？`,
      )
    ) {
      return;
    }
    setPendingDeviceActionId(deviceId);
    try {
      const response = await fetch(
        `/api/admin/devices/${encodeURIComponent(deviceId)}/${action}`,
        { method: "POST" },
      );
      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!response.ok) {
        setMessage(data.error ?? t("employees.operationFailed"));
        return;
      }
      setMessage(action === "approve" ? "设备已批准。" : "设备申请已拒绝。");
      await Promise.all([loadPendingDevices(), load()]);
    } finally {
      setPendingDeviceActionId(null);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial user list fetch on mount
    void load();
  }, [load]);

  useEffect(() => {
    if (activeView !== "devices") return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load pending devices when the tab is selected
    void loadPendingDevices();
  }, [activeView, loadPendingDevices]);

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
      <div className="grid grid-cols-2 gap-3 md:hidden">
        <StatCard label={t("employees.statsTotalEmployees")} value={stats.total} />
        <StatCard label={t("employees.statsStaffCount")} value={stats.staff} />
        <StatCard label={t("employees.statsAdminCount")} value={stats.admins} />
        <StatCard
          label={t("employees.statsActiveEmployees")}
          value={stats.active}
        />
      </div>
      <div className="hidden gap-3 md:grid md:grid-cols-3 xl:grid-cols-6">
        <StatCard label={t("employees.statsTotalEmployees")} value={stats.total} />
        <StatCard
          label={t("employees.statsCurrentEmployees")}
          value={stats.current}
        />
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
        <div
          className="flex flex-wrap gap-2"
          role="tablist"
          aria-label="团队管理视图"
        >
          <Button
            variant={activeView === "members" ? "primary" : "secondary"}
            role="tab"
            aria-selected={activeView === "members"}
            onClick={() => selectView("members")}
          >
            团队成员
          </Button>
          <Button
            variant={activeView === "devices" ? "primary" : "secondary"}
            role="tab"
            aria-selected={activeView === "devices"}
            onClick={() => selectView("devices")}
          >
            设备授权
            {pendingDevices.length > 0 ? ` (${pendingDevices.length})` : ""}
          </Button>
        </div>
        {message && <p className="mt-3 text-sm text-[#172033]">{message}</p>}
      </div>

      {activeView === "members" && (
        <div className="surface-card p-4 md:p-6">
          <Button onClick={() => setShowCreate(true)}>
            {t("employees.createStaff")}
          </Button>
        </div>
      )}

      {activeView === "members" && showCreate && (
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

      {activeView === "members" && resetUserId && (
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

      {activeView === "members" && <div className="surface-card p-6">
        <h3 className="text-lg font-medium text-[#172033]">
          {t("employees.listTitle")}
        </h3>
        {loading ? (
          <p className="mt-4 text-sm text-[#6B7890]">{t("common.loading")}</p>
        ) : currentUsers.length === 0 ? (
          <p className="mt-4 text-sm text-[#6B7890]">{t("common.noData")}</p>
        ) : (
          <>
            <div className="mt-4 space-y-3 md:hidden">
              {currentUsers.map((u) => (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => void openMemberDetail(u)}
                  className="surface-muted block w-full rounded-xl p-4 text-left transition hover:ring-2 hover:ring-[#2F6FB3]/30"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-[#172033]">
                        {u.name}
                      </p>
                      <p className="mt-1 break-all text-sm text-[#6B7890]">
                        {u.email}
                      </p>
                    </div>
                    <ChevronRight className="mt-1 h-5 w-5 shrink-0 text-[#6B7890]" />
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs">
                    <span className="rounded-full bg-[#E8F1FB] px-2.5 py-1 text-[#2F6FB3]">
                      {u.role === "admin"
                        ? t("employees.adminRole")
                        : t("employees.staffRole")}
                    </span>
                    <span className="rounded-full bg-white px-2.5 py-1 text-[#516078]">
                      {statusLabel(u.status)}
                    </span>
                    <span className="rounded-full bg-white px-2.5 py-1 text-[#516078]">
                      {u.role === "admin"
                        ? "独立验证"
                        : u.cloudflare_access_email
                          ? "Access 已绑定"
                          : "Access 未绑定"}
                    </span>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-3 text-xs text-[#6B7890]">
                    <span>
                      最近登录
                      <strong className="mt-1 block font-mono font-normal text-[#172033]">
                        {formatHongKongDateTime(u.last_login_at)}
                      </strong>
                    </span>
                    <span>
                      设备
                      <strong className="mt-1 block font-normal text-[#172033]">
                        {u.device_approved_count} 已授权 ·{" "}
                        {u.device_pending_count} 待审核
                      </strong>
                    </span>
                  </div>
                </button>
              ))}
            </div>
            <div className="mt-4 hidden overflow-x-auto md:block">
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
          </>
        )}
      </div>}

      {activeView === "members" && selectedUser && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-[#172033]/40" />
          <section className="absolute inset-y-0 right-0 flex w-full max-w-lg flex-col overflow-hidden bg-white shadow-2xl">
            <header className="flex items-center justify-between border-b border-[#E3E8F0] px-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-lg font-semibold text-[#172033]">
                  {selectedUser.name}
                </p>
                <p className="break-all text-sm text-[#6B7890]">
                  {selectedUser.email}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedUser(null)}
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-[#516078] hover:bg-[#F0F4F8]"
                aria-label="关闭成员详情"
              >
                <X className="h-5 w-5" />
              </button>
            </header>

            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
              <section className="surface-muted rounded-xl p-4">
                <h3 className="font-semibold text-[#172033]">基本资料</h3>
                <dl className="mt-3 grid gap-3 text-sm">
                  <div>
                    <dt className="text-xs text-[#6B7890]">角色</dt>
                    <dd className="mt-1 text-[#172033]">
                      {selectedUser.role === "admin"
                        ? t("employees.adminRole")
                        : t("employees.staffRole")}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-[#6B7890]">帐号状态</dt>
                    <dd className="mt-1 text-[#172033]">
                      {statusLabel(selectedUser.status)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-[#6B7890]">最近登录</dt>
                    <dd className="mt-1 font-mono text-[#172033]">
                      {formatHongKongDateTime(selectedUser.last_login_at)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-[#6B7890]">登录失败 / 锁定</dt>
                    <dd className="mt-1 text-[#172033]">
                      {selectedUser.failed_login_count} 次 ·{" "}
                      {selectedUser.is_locked ? "已锁定" : "正常"}
                    </dd>
                  </div>
                </dl>
              </section>

              <section className="surface-muted rounded-xl p-4">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-[#2F6FB3]" />
                  <h3 className="font-semibold text-[#172033]">Access 身份</h3>
                </div>
                <p className="mt-2 text-sm text-[#6B7890]">
                  此邮箱用于 Cloudflare Access 身份验证，与 CRM 公司帐号为一对一绑定。
                </p>
                <p className="mt-3 break-all text-sm text-[#172033]">
                  {selectedUser.role === "admin"
                    ? "独立验证"
                    : selectedUser.cloudflare_access_email ?? "未绑定"}
                </p>
                {selectedUser.role === "staff" &&
                selectedUser.cloudflare_access_email ? (
                  <Button
                    className="mt-3 w-full"
                    variant="secondary"
                    disabled={bindingResetting}
                    onClick={() => void resetAccessBinding()}
                  >
                    {bindingResetting ? "处理中…" : "解除 Access 绑定"}
                  </Button>
                ) : null}
              </section>

              <section className="surface-muted rounded-xl p-4">
                <h3 className="font-semibold text-[#172033]">设备授权</h3>
                {selectedDeviceSummary ? (
                  <p className="mt-2 text-sm text-[#516078]">
                    当前授权：{selectedDeviceSummary.approved_count} /{" "}
                    {selectedDeviceSummary.limit}
                  </p>
                ) : null}
                {selectedDeviceSummary &&
                selectedDeviceSummary.approved_count >=
                  selectedDeviceSummary.limit &&
                selectedDevices.some((device) => device.status === "pending") ? (
                  <p className="mt-2 text-xs text-amber-700">
                    已达到设备上限，批准待审核设备时需要替换一台现有设备。
                  </p>
                ) : null}
                {detailLoading ? (
                  <div className="mt-4 flex items-center gap-2 text-sm text-[#6B7890]">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    载入中…
                  </div>
                ) : selectedDevices.length === 0 ? (
                  <p className="mt-3 text-sm text-[#6B7890]">暂无设备记录</p>
                ) : (
                  <div className="mt-3 space-y-3">
                    {selectedDevices.map((device) => (
                      <div
                        key={device.id}
                        className="rounded-lg border border-[#E3E8F0] bg-white p-3"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="font-medium text-[#172033]">
                              {getDeviceDisplayLabel(device)}
                            </p>
                            <p className="mt-1 break-all font-mono text-xs text-[#6B7890]">
                              {getDeviceNetworkAddress(device)}
                            </p>
                          </div>
                          <span className="shrink-0 text-xs text-[#516078]">
                            {device.status === "approved"
                              ? "已批准"
                              : device.status === "pending"
                                ? "待审核"
                                : device.status === "rejected"
                                  ? "已拒绝"
                                  : "已撤销"}
                          </span>
                        </div>
                        <div className="mt-3 grid gap-1 text-xs text-[#6B7890]">
                          <span>
                            建立：{formatHongKongDateTime(device.created_at)}
                          </span>
                          <span>
                            最后登录：{formatHongKongDateTime(device.last_seen_at)}
                          </span>
                          <span>批准人：{device.approved_by_name ?? "—"}</span>
                        </div>
                        <div className="mt-3 flex gap-2">
                          {device.status === "pending" ? (
                            <>
                              {selectedDeviceSummary &&
                              selectedDeviceSummary.approved_count >=
                                selectedDeviceSummary.limit ? (
                                <Button
                                  size="sm"
                                  className="flex-1"
                                  onClick={() =>
                                    void openReplacementModal(device)
                                  }
                                >
                                  批准并替换
                                </Button>
                              ) : (
                                <Button
                                  size="sm"
                                  className="flex-1"
                                  onClick={() =>
                                    void runMemberDeviceAction(
                                      device.id,
                                      "approve",
                                    )
                                  }
                                >
                                  批准
                                </Button>
                              )}
                              <Button
                                size="sm"
                                className="flex-1"
                                variant="secondary"
                                onClick={() =>
                                  void runMemberDeviceAction(device.id, "reject")
                                }
                              >
                                拒绝
                              </Button>
                            </>
                          ) : device.status === "approved" ? (
                            <Button
                              size="sm"
                              className="w-full"
                              variant="secondary"
                              onClick={() =>
                                void runMemberDeviceAction(device.id, "revoke")
                              }
                            >
                              撤销授权
                            </Button>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>
          </section>
        </div>
      )}

      {replacementModal && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center p-3 sm:items-center">
          <div
            className="absolute inset-0 bg-[#172033]/45"
            onClick={() =>
              replacementSubmitting ? undefined : setReplacementModal(null)
            }
          />
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="approve-replace-title"
            className="relative flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
          >
            <header className="flex items-start justify-between gap-3 border-b border-[#E3E8F0] px-4 py-4">
              <div>
                <h2
                  id="approve-replace-title"
                  className="text-lg font-semibold text-[#172033]"
                >
                  批准并替换
                </h2>
                <p className="mt-1 text-sm text-amber-700">
                  设备数量已达到上限
                </p>
              </div>
              <button
                type="button"
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-[#516078] hover:bg-[#F0F4F8]"
                aria-label="关闭批准并替换"
                disabled={replacementSubmitting}
                onClick={() => setReplacementModal(null)}
              >
                <X className="h-5 w-5" />
              </button>
            </header>

            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
              <section className="surface-muted rounded-xl p-4">
                <h3 className="font-semibold text-[#172033]">新设备</h3>
                <dl className="mt-3 grid gap-2 text-sm">
                  <div>
                    <dt className="text-xs text-[#6B7890]">Browser / OS</dt>
                    <dd className="mt-0.5 break-words text-[#172033]">
                      {getDeviceDisplayLabel(replacementModal.pendingDevice)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-[#6B7890]">IP</dt>
                    <dd className="mt-0.5 break-all font-mono text-[#172033]">
                      {getDeviceNetworkAddress(replacementModal.pendingDevice)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-[#6B7890]">申请时间</dt>
                    <dd className="mt-0.5 font-mono text-[#172033]">
                      {formatHongKongDateTime(
                        replacementModal.pendingDevice.created_at,
                      )}
                    </dd>
                  </div>
                </dl>
              </section>

              <section>
                <div className="flex items-center justify-between gap-3">
                  <h3 className="font-semibold text-[#172033]">
                    将替换以下已授权设备
                  </h3>
                  <span className="shrink-0 text-xs text-amber-700">
                    {replacementModal.candidates.length} /{" "}
                    {replacementModal.limit || replacementModal.candidates.length}
                  </span>
                </div>
                {replacementLoading ? (
                  <div className="mt-4 flex items-center gap-2 text-sm text-[#6B7890]">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    载入设备…
                  </div>
                ) : (
                  <div className="mt-3 space-y-2">
                    {replacementModal.candidates.map((device, index) => (
                      <label
                        key={device.id}
                        className={`block cursor-pointer rounded-xl border p-3 transition ${
                          replacementModal.selectedReplacementId === device.id
                            ? "border-[#2F6FB3] bg-[#F1F7FD]"
                            : "border-[#E3E8F0] bg-white"
                        }`}
                      >
                        <span className="flex items-start gap-3">
                          <input
                            type="radio"
                            name="replacement-device"
                            className="mt-1 h-4 w-4 accent-[#2F6FB3]"
                            checked={
                              replacementModal.selectedReplacementId ===
                              device.id
                            }
                            disabled={replacementSubmitting}
                            onChange={() =>
                              setReplacementModal((current) =>
                                current
                                  ? {
                                      ...current,
                                      selectedReplacementId: device.id,
                                    }
                                  : current,
                              )
                            }
                          />
                          <span className="min-w-0 flex-1">
                            <span className="flex flex-wrap items-center gap-2 font-medium text-[#172033]">
                              {getDeviceDisplayLabel(device)}
                              {index === 0 ? (
                                <span className="rounded-full bg-[#FFF3D6] px-2 py-0.5 text-xs font-normal text-amber-700">
                                  建议替换
                                </span>
                              ) : null}
                            </span>
                            <span className="mt-1 block break-all text-xs text-[#6B7890]">
                              最近 IP：
                              {getDeviceNetworkAddress(device)}
                            </span>
                            <span className="mt-1 block text-xs text-[#6B7890]">
                              最近登录：
                              {formatHongKongDateTime(device.last_seen_at)}
                            </span>
                            <span className="mt-1 block text-xs text-[#6B7890]">
                              授权时间：
                              {formatHongKongDateTime(device.approved_at)}
                            </span>
                          </span>
                        </span>
                      </label>
                    ))}
                  </div>
                )}
              </section>
            </div>

            <footer className="flex gap-2 border-t border-[#E3E8F0] p-4">
              <Button
                className="flex-1"
                variant="secondary"
                disabled={replacementSubmitting}
                onClick={() => setReplacementModal(null)}
              >
                取消
              </Button>
              <Button
                className="flex-1"
                disabled={
                  replacementLoading ||
                  replacementSubmitting ||
                  !replacementModal.selectedReplacementId
                }
                onClick={() => void submitReplacement()}
              >
                {replacementSubmitting ? "处理中…" : "批准并替换"}
              </Button>
            </footer>
          </section>
        </div>
      )}

      {activeView === "members" && deleteTarget && (
        <DeleteStaffModal
          user={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onDeleted={handleStaffDeleted}
        />
      )}

      {activeView === "members" && <div className="surface-card p-6">
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
          <>
            <div className="mt-4 space-y-3 md:hidden">
              {formerUsers.map((u) => (
                <article
                  key={u.id}
                  className="surface-muted rounded-xl p-4"
                >
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-[#172033]">
                      {u.name}
                    </p>
                    <p className="mt-1 break-all text-sm text-[#6B7890]">
                      {u.email}
                    </p>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs">
                    <span className="rounded-full bg-[#E8F1FB] px-2.5 py-1 text-[#2F6FB3]">
                      {u.role === "admin"
                        ? t("employees.adminRole")
                        : t("employees.staffRole")}
                    </span>
                    <span className="rounded-full bg-white px-2.5 py-1 text-[#516078]">
                      {t("employees.statusDeleted")}
                    </span>
                  </div>
                  <dl className="mt-3 grid gap-2 text-xs text-[#6B7890]">
                    <div>
                      <dt>{t("employees.deletedAt")}</dt>
                      <dd className="mt-0.5 font-mono text-sm text-[#172033]">
                        {formatHongKongDateTime(u.deleted_at)}
                      </dd>
                    </div>
                    <div>
                      <dt>{t("employees.deletedBy")}</dt>
                      <dd className="mt-0.5 text-sm text-[#172033]">
                        {u.deleted_by_name ?? "—"}
                      </dd>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <dt>{t("employees.colTransferredCustomers")}</dt>
                        <dd className="mt-0.5 text-sm text-[#172033]">
                          {formatOptionalCount(u.transferred_customer_count)}
                        </dd>
                      </div>
                      <div>
                        <dt>{t("employees.colPrimaryAssigneesSynced")}</dt>
                        <dd className="mt-0.5 text-sm text-[#172033]">
                          {formatOptionalCount(
                            u.primary_assignees_transferred_count,
                          )}
                        </dd>
                      </div>
                    </div>
                    <div>
                      <dt>客户状态</dt>
                      <dd className="mt-0.5 text-sm text-[#172033]">
                        {u.transferred_to_admin_name ??
                          t("employees.customerTransferredToAdmin")}
                      </dd>
                    </div>
                  </dl>
                </article>
              ))}
            </div>
            <div className="mt-4 hidden overflow-x-auto md:block">
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
                    {t("employees.colPrimaryAssigneesSynced")}
                  </th>
                  <th className="px-3 py-2">
                    {t("employees.colCollaboratorsRemoved")}
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
                      {formatOptionalCount(u.transferred_customer_count)}
                    </td>
                    <td className="px-3 py-2">
                      {formatOptionalCount(
                        u.primary_assignees_transferred_count,
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {formatOptionalCount(
                        u.collaborator_assignees_removed_count,
                      )}
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
          </>
        )}
      </div>}

      {activeView === "devices" && (
        <PendingDevicesPanel
          items={pendingDevices}
          userSummaries={pendingDeviceSummaries}
          loading={pendingDevicesLoading}
          actionId={pendingDeviceActionId}
          onAction={runPendingDeviceAction}
          onApproveAndReplace={openReplacementModal}
        />
      )}
    </div>
  );
}

function PendingDevicesPanel({
  items,
  userSummaries,
  loading,
  actionId,
  onAction,
  onApproveAndReplace,
}: {
  items: DeviceListItem[];
  userSummaries: Record<string, DeviceSummary>;
  loading: boolean;
  actionId: string | null;
  onAction: (deviceId: string, action: "approve" | "reject") => void;
  onApproveAndReplace: (device: DeviceListItem) => void;
}) {
  return (
    <div className="surface-card p-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-medium text-[#172033]">待审核设备</h3>
          <p className="mt-1 text-sm text-[#6B7890]">
            审核团队成员的新设备登录申请。
          </p>
        </div>
        <span className="rounded-full bg-[#FFF3D6] px-3 py-1 text-sm text-amber-700">
          {items.length} 台待审核
        </span>
      </div>

      {loading ? (
        <p className="mt-4 text-sm text-[#6B7890]">载入中…</p>
      ) : items.length === 0 ? (
        <p className="mt-4 text-sm text-[#6B7890]">暂无待审核设备</p>
      ) : (
        <>
          <div className="mt-4 space-y-3 md:hidden">
            {items.map((item) => (
              <div
                key={item.id}
                className="rounded-xl border border-[#E3E8F0] bg-white p-4"
              >
                {(() => {
                  const summary = userSummaries[item.user_id];
                  const atLimit =
                    summary != null &&
                    summary.approved_count >= summary.limit;
                  return (
                    <>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-[#172033]">
                      {item.user_display_name}
                    </p>
                    <p className="mt-1 break-all text-xs text-[#6B7890]">
                      {item.user_email}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs text-amber-700">待审核</span>
                </div>
                <dl className="mt-3 grid gap-2 text-xs text-[#6B7890]">
                  <div>
                    <dt>设备</dt>
                    <dd className="mt-0.5 text-sm text-[#172033]">
                      {getDeviceDisplayLabel(item)}
                    </dd>
                  </div>
                  <div>
                    <dt>最近 IP</dt>
                    <dd className="mt-0.5 break-all font-mono text-sm text-[#172033]">
                      {getDeviceNetworkAddress(item)}
                    </dd>
                  </div>
                  <div>
                    <dt>申请时间</dt>
                    <dd className="mt-0.5 font-mono text-sm text-[#172033]">
                      {formatHongKongDateTime(item.created_at)}
                    </dd>
                  </div>
                  <div>
                    <dt>设备授权</dt>
                    <dd className="mt-0.5 text-sm text-[#172033]">
                      {summary
                        ? `${summary.approved_count} / ${summary.limit}`
                        : "—"}
                    </dd>
                  </div>
                </dl>
                <div className="mt-3 flex gap-2">
                  {atLimit ? (
                    <Button
                      size="sm"
                      className="flex-1"
                      disabled={actionId === item.id}
                      onClick={() => onApproveAndReplace(item)}
                    >
                      批准并替换
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      className="flex-1"
                      disabled={actionId === item.id}
                      onClick={() => onAction(item.id, "approve")}
                    >
                      批准
                    </Button>
                  )}
                  <Button
                    size="sm"
                    className="flex-1"
                    variant="secondary"
                    disabled={actionId === item.id}
                    onClick={() => onAction(item.id, "reject")}
                  >
                    拒绝
                  </Button>
                </div>
                    </>
                  );
                })()}
              </div>
            ))}
          </div>
          <div className="mt-4 hidden overflow-x-auto md:block">
            <table className="min-w-full text-left text-sm">
              <thead>
                <tr className="table-head border-b border-[#E3E8F0] text-[#6B7890]">
                  <th className="px-3 py-2">团队成员</th>
                  <th className="px-3 py-2">设备</th>
                  <th className="px-3 py-2">最近 IP</th>
                  <th className="px-3 py-2">申请时间</th>
                  <th className="px-3 py-2">设备授权</th>
                  <th className="px-3 py-2">操作</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr
                    key={item.id}
                    className="table-row border-b border-[#EEF3F8]"
                  >
                    {(() => {
                      const summary = userSummaries[item.user_id];
                      const atLimit =
                        summary != null &&
                        summary.approved_count >= summary.limit;
                      return (
                        <>
                    <td className="px-3 py-2">
                      <div className="font-medium">{item.user_display_name}</div>
                      <div className="text-xs text-[#6B7890]">
                        {item.user_email}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      {getDeviceDisplayLabel(item)}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {getDeviceNetworkAddress(item)}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {formatHongKongDateTime(item.created_at)}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {summary
                        ? `${summary.approved_count} / ${summary.limit}`
                        : "—"}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex gap-2">
                        {atLimit ? (
                          <Button
                            size="sm"
                            disabled={actionId === item.id}
                            onClick={() => onApproveAndReplace(item)}
                          >
                            批准并替换
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            disabled={actionId === item.id}
                            onClick={() => onAction(item.id, "approve")}
                          >
                            批准
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={actionId === item.id}
                          onClick={() => onAction(item.id, "reject")}
                        >
                          拒绝
                        </Button>
                      </div>
                    </td>
                        </>
                      );
                    })()}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
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
