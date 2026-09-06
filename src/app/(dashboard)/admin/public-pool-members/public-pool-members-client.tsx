"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form";
import { PageIntro } from "@/components/ui/page-intro";
import { formatHongKongDateTime } from "@/lib/timezone";
import type { AdminUserView } from "@/lib/users-admin/types";

type PublicPoolMember = AdminUserView & {
  next_claim_at: string | null;
};

type PublicPoolMemberPolicy = {
  firstLoginAt: string | null;
  eligibilityAt: string | null;
  remainingProtectionDays: number;
  poolClaimPaused: boolean;
  quotaOverride: number | null;
  cooldownHoursOverride: number | null;
  effectiveQuota: number;
  effectiveCooldownHours: number;
  canClaimByMemberPolicy: boolean;
  blockedReasonKey: "adminPaused" | "newMemberProtection" | null;
};

type OverrideMode = "default" | "custom";
type EligibilityStatus = "paused" | "protected" | "eligible";

function getEligibilityStatus(
  member: PublicPoolMember,
  paused = member.pool_claim_paused ?? false,
): EligibilityStatus {
  if (paused) return "paused";
  return member.pool_claim_eligibility_status === "protected" ||
      (member.pool_claim_eligibility_status === "paused" &&
        (member.pool_claim_remaining_days ?? 0) > 0)
    ? "protected"
    : "eligible";
}

function eligibilityLabel(status: EligibilityStatus): string {
  if (status === "paused") return "已暂停";
  if (status === "protected") return "新人保护期";
  return "可领取";
}

function eligibilityVariant(
  status: EligibilityStatus,
): "success" | "warning" | "default" {
  return status === "eligible" ? "success" : "warning";
}

function nextClaimLabel(
  member: PublicPoolMember,
  status: EligibilityStatus,
): string {
  if (status === "paused") return "—";
  if (status === "protected") return "保护期结束后开放";
  return member.next_claim_at
    ? formatHongKongDateTime(member.next_claim_at)
    : "现在";
}

function PublicPoolMemberCard({
  member,
  onOpen,
}: {
  member: PublicPoolMember;
  onOpen: () => void;
}) {
  const status = getEligibilityStatus(member);

  return (
    <article className="surface-card p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold text-[#172033]">
            {member.name}
          </h2>
          <p className="mt-1 break-all text-xs text-[#6B7890]">
            {member.email}
          </p>
        </div>
        <Badge variant={eligibilityVariant(status)}>
          {eligibilityLabel(status)}
        </Badge>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-xs text-[#6B7890]">7 天配额</dt>
          <dd className="mt-1 font-semibold text-[#172033]">
            {member.pool_claim_effective_quota ?? "—"}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-[#6B7890]">领取冷却</dt>
          <dd className="mt-1 font-semibold text-[#172033]">
            {member.pool_claim_effective_cooldown_hours ?? "—"} 小时
          </dd>
        </div>
        <div className="col-span-2">
          <dt className="text-xs text-[#6B7890]">下次可领取</dt>
          <dd className="mt-1 text-xs text-[#172033]">
            {nextClaimLabel(member, status)}
          </dd>
        </div>
        {status === "protected" ? (
          <>
            <div className="col-span-2">
              <dt className="text-xs text-[#6B7890]">自动开放</dt>
              <dd className="mt-1 font-mono text-xs text-[#172033]">
                {formatHongKongDateTime(member.pool_claim_eligibility_at ?? null)}
              </dd>
            </div>
            <div className="col-span-2">
              <dt className="text-xs text-[#6B7890]">剩余</dt>
              <dd className="mt-1 text-[#172033]">
                {member.pool_claim_remaining_days ?? 0} 天
              </dd>
            </div>
          </>
        ) : null}
      </dl>

      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="mt-4 w-full"
        onClick={onOpen}
      >
        管理权限 →
      </Button>
    </article>
  );
}

function PublicPoolPolicyPanel({
  member,
  onClose,
  onSaved,
}: {
  member: PublicPoolMember;
  onClose: () => void;
  onSaved: (policy: PublicPoolMemberPolicy) => void;
}) {
  const initialStatus = getEligibilityStatus(member);
  const [paused, setPaused] = useState(initialStatus === "paused");
  const [quotaMode, setQuotaMode] = useState<OverrideMode>(
    member.pool_claim_quota_override == null ? "default" : "custom",
  );
  const [quota, setQuota] = useState(
    member.pool_claim_quota_override == null
      ? ""
      : String(member.pool_claim_quota_override),
  );
  const [cooldownMode, setCooldownMode] = useState<OverrideMode>(
    member.pool_claim_cooldown_hours_override == null ? "default" : "custom",
  );
  const [cooldown, setCooldown] = useState(
    member.pool_claim_cooldown_hours_override == null
      ? ""
      : String(member.pool_claim_cooldown_hours_override),
  );
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const status = getEligibilityStatus(member, paused);
  const effectiveQuota =
    quotaMode === "default" ? member.pool_claim_effective_quota : quota;
  const effectiveCooldown =
    cooldownMode === "default"
      ? member.pool_claim_effective_cooldown_hours
      : cooldown;
  const invalidCustomValue =
    (quotaMode === "custom" && quota === "") ||
    (cooldownMode === "custom" && cooldown === "");

  async function save() {
    if (invalidCustomValue) {
      setMessage("请输入自定义配额和冷却时间");
      return;
    }

    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch(
        `/api/admin/users/${encodeURIComponent(member.id)}/public-pool-policy`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            poolClaimPaused: paused,
            quotaOverride:
              quotaMode === "default" ? null : Number(quota),
            cooldownHoursOverride:
              cooldownMode === "default" ? null : Number(cooldown),
          }),
        },
      );
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        policy?: PublicPoolMemberPolicy;
      };
      if (!response.ok || !body.policy) {
        setMessage(body.error ?? "保存失败");
        return;
      }
      onSaved(body.policy);
      setMessage("领取权限已更新");
    } catch {
      setMessage("网络错误，请稍后再试");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex justify-end bg-black/40"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="flex h-full w-full max-w-xl flex-col overflow-hidden bg-white shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="public-pool-policy-title"
      >
        <header className="flex items-start justify-between gap-4 border-b border-[#E7EDF5] px-4 py-4 pt-[max(1rem,env(safe-area-inset-top,0px))] sm:px-6">
          <div className="min-w-0">
            <h2
              id="public-pool-policy-title"
              className="truncate text-lg font-semibold text-[#172033]"
            >
              {member.name}
            </h2>
            <p className="mt-1 text-sm text-[#6B7890]">公共池领取权限</p>
          </div>
          <button
            type="button"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-2xl text-[#516078] hover:bg-[#F2F6FA]"
            aria-label="关闭"
            onClick={onClose}
          >
            ×
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 pb-8 sm:px-6">
          <section className="rounded-xl border border-[#DCE7F5] bg-[#F8FBFF] p-4">
            <h3 className="text-sm font-semibold text-[#172033]">领取资格</h3>
            <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs text-[#6B7890]">领取资格</dt>
                <dd className="mt-1 text-[#172033]">
                  {eligibilityLabel(status)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-[#6B7890]">首次登录</dt>
                <dd className="mt-1 font-mono text-xs text-[#172033]">
                  {formatHongKongDateTime(member.first_login_at ?? null)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-[#6B7890]">自动开放</dt>
                <dd className="mt-1 font-mono text-xs text-[#172033]">
                  {formatHongKongDateTime(
                    member.pool_claim_eligibility_at ?? null,
                  )}
                </dd>
              </div>
              {status === "protected" ? (
                <div>
                  <dt className="text-xs text-[#6B7890]">剩余</dt>
                  <dd className="mt-1 text-[#172033]">
                    {member.pool_claim_remaining_days ?? 0} 天
                  </dd>
                </div>
              ) : null}
            </dl>
          </section>

          <section className="mt-4 rounded-xl border border-[#EEF3F8] p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-[#172033]">
                  领取状态：{paused ? "已暂停" : "正常"}
                </h3>
                <p className="mt-1 text-xs text-[#6B7890]">
                  仅影响新的公共池领取，现有客户不受影响。
                </p>
              </div>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={saving}
                onClick={() => setPaused((current) => !current)}
              >
                {paused ? "恢复领取" : "暂停领取"}
              </Button>
            </div>
          </section>

          <section className="mt-4 rounded-xl border border-[#EEF3F8] p-4">
            <fieldset className="grid gap-3">
              <legend className="text-sm font-semibold text-[#172033]">
                7 天领取配额
              </legend>
              <label className="flex items-start gap-2 text-sm text-[#516078]">
                <input
                  type="radio"
                  name={`quota-mode-${member.id}`}
                  checked={quotaMode === "default"}
                  onChange={() => setQuotaMode("default")}
                />
                <span>
                  使用系统默认（{member.pool_claim_effective_quota ?? "—"}）
                </span>
              </label>
              <label className="flex items-start gap-2 text-sm text-[#516078]">
                <input
                  type="radio"
                  name={`quota-mode-${member.id}`}
                  checked={quotaMode === "custom"}
                  onChange={() => setQuotaMode("custom")}
                />
                <span className="w-full">
                  自定义
                  <Input
                    className="mt-2"
                    type="number"
                    min={0}
                    max={100}
                    step={1}
                    value={quota}
                    disabled={quotaMode !== "custom"}
                    onChange={(event) => setQuota(event.target.value)}
                    aria-label={`${member.name} 7 天领取配额`}
                  />
                </span>
              </label>
            </fieldset>
          </section>

          <section className="mt-4 rounded-xl border border-[#EEF3F8] p-4">
            <fieldset className="grid gap-3">
              <legend className="text-sm font-semibold text-[#172033]">
                领取冷却
              </legend>
              <label className="flex items-start gap-2 text-sm text-[#516078]">
                <input
                  type="radio"
                  name={`cooldown-mode-${member.id}`}
                  checked={cooldownMode === "default"}
                  onChange={() => setCooldownMode("default")}
                />
                <span>
                  使用系统默认（
                  {member.pool_claim_effective_cooldown_hours ?? "—"} 小时）
                </span>
              </label>
              <label className="flex items-start gap-2 text-sm text-[#516078]">
                <input
                  type="radio"
                  name={`cooldown-mode-${member.id}`}
                  checked={cooldownMode === "custom"}
                  onChange={() => setCooldownMode("custom")}
                />
                <span className="w-full">
                  自定义
                  <Input
                    className="mt-2"
                    type="number"
                    min={0}
                    max={720}
                    step={1}
                    value={cooldown}
                    disabled={cooldownMode !== "custom"}
                    onChange={(event) => setCooldown(event.target.value)}
                    aria-label={`${member.name} 领取冷却小时`}
                  />
                </span>
              </label>
            </fieldset>
          </section>

          <section className="mt-4 rounded-xl border border-[#DCE7F5] bg-[#F8FBFF] p-4">
            <h3 className="text-sm font-semibold text-[#172033]">
              当前有效规则
            </h3>
            <dl className="mt-3 grid gap-2 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-[#6B7890]">7 天领取配额</dt>
                <dd className="font-semibold text-[#172033]">
                  {effectiveQuota === "" || effectiveQuota == null
                    ? "—"
                    : effectiveQuota}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-[#6B7890]">领取冷却</dt>
                <dd className="font-semibold text-[#172033]">
                  {effectiveCooldown === "" || effectiveCooldown == null
                    ? "—"
                    : effectiveCooldown}{" "}
                  小时
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-[#6B7890]">领取状态</dt>
                <dd className="font-semibold text-[#172033]">
                  {paused ? "已暂停" : "正常"}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-[#6B7890]">领取资格</dt>
                <dd className="font-semibold text-[#172033]">
                  {eligibilityLabel(status)}
                </dd>
              </div>
            </dl>
          </section>
        </div>

        <footer className="border-t border-[#E7EDF5] bg-white px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom,0px))] sm:px-6">
          <Button
            type="button"
            className="w-full"
            disabled={saving || invalidCustomValue}
            onClick={() => void save()}
          >
            {saving ? "保存中…" : "保存领取权限"}
          </Button>
          {message ? (
            <p className="mt-2 text-center text-xs text-[#516078]" role="status">
              {message}
            </p>
          ) : null}
        </footer>
      </section>
    </div>
  );
}

export function PublicPoolMembersClient() {
  const [members, setMembers] = useState<PublicPoolMember[]>([]);
  const [selectedMember, setSelectedMember] =
    useState<PublicPoolMember | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/public-pool-members");
      const body = (await response.json().catch(() => ({}))) as {
        items?: PublicPoolMember[];
        error?: string;
      };
      if (!response.ok) {
        setError(body.error ?? "无法加载成员领取权限");
        return;
      }
      setMembers(body.items ?? []);
    } catch {
      setError("网络错误，请稍后再试");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial member policy fetch on mount
    void load();
  }, [load]);

  function updateSavedPolicy(
    memberId: string,
    policy: PublicPoolMemberPolicy,
  ) {
    setMembers((current) =>
      current.map((member) =>
        member.id === memberId
          ? {
              ...member,
              pool_claim_paused: policy.poolClaimPaused,
              pool_claim_quota_override: policy.quotaOverride,
              pool_claim_cooldown_hours_override:
                policy.cooldownHoursOverride,
              pool_claim_effective_quota: policy.effectiveQuota,
              pool_claim_effective_cooldown_hours:
                policy.effectiveCooldownHours,
              pool_claim_eligibility_at: policy.eligibilityAt,
              pool_claim_remaining_days: policy.remainingProtectionDays,
              pool_claim_eligibility_status: policy.poolClaimPaused
                ? "paused"
                : policy.blockedReasonKey === "newMemberProtection"
                  ? "protected"
                  : "eligible",
              updated_at: new Date().toISOString(),
            }
          : member,
      ),
    );
    setSelectedMember((current) =>
      current?.id === memberId
        ? {
            ...current,
            pool_claim_paused: policy.poolClaimPaused,
            pool_claim_quota_override: policy.quotaOverride,
            pool_claim_cooldown_hours_override:
              policy.cooldownHoursOverride,
            pool_claim_effective_quota: policy.effectiveQuota,
            pool_claim_effective_cooldown_hours:
              policy.effectiveCooldownHours,
            pool_claim_eligibility_at: policy.eligibilityAt,
            pool_claim_remaining_days: policy.remainingProtectionDays,
            pool_claim_eligibility_status: policy.poolClaimPaused
              ? "paused"
              : policy.blockedReasonKey === "newMemberProtection"
                ? "protected"
                : "eligible",
          }
        : current,
    );
  }

  return (
    <div className="space-y-6">
      <PageIntro
        title="成员公共池领取权限"
        description="单独管理团队成员的公共池领取资格、配额及冷却时间。新人保护期自首次成功登录 CRM 起自动计算 45 天。"
      />

      {error ? (
        <div className="surface-card border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="surface-card p-6 text-sm text-[#6B7890]">
          加载中…
        </div>
      ) : members.length === 0 ? (
        <div className="surface-card p-6 text-sm text-[#6B7890]">
          暂无启用中的团队成员。
        </div>
      ) : (
        <div className="grid gap-4">
          {members.map((member) => (
            <PublicPoolMemberCard
              key={`${member.id}-${member.updated_at}`}
              member={member}
              onOpen={() => setSelectedMember(member)}
            />
          ))}
        </div>
      )}

      {selectedMember ? (
        <PublicPoolPolicyPanel
          key={selectedMember.id}
          member={selectedMember}
          onClose={() => setSelectedMember(null)}
          onSaved={(policy) => updateSavedPolicy(selectedMember.id, policy)}
        />
      ) : null}
    </div>
  );
}
