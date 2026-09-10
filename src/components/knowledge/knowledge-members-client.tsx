"use client";

import { useCallback, useMemo, useState } from "react";
import { Check, ChevronRight, Lock, Search } from "lucide-react";
import { useTranslation } from "@/i18n/provider";
import { Button } from "@/components/ui/button";
import { Badge, EmptyState } from "@/components/ui/card";
import { KnowledgeMobileSheet } from "@/components/knowledge/knowledge-mobile-sheet";
import { KNOWLEDGE_ROLES } from "@/lib/knowledge/constants";
import { knowledgeDisplayInitials } from "@/lib/knowledge/display-initials";
import { resolveKnowledgeApiError } from "@/lib/knowledge/error-messages";
import type { KnowledgeRole } from "../../../drizzle/schema/knowledge-user-roles";
import { cn } from "@/lib/cn";

type KnowledgeMember = {
  id: string;
  email: string;
  displayName: string;
  role: KnowledgeRole | null;
};

type MemberDraft = {
  role: KnowledgeRole | "";
};

type MemberFilter = "all" | "unassigned";

function buildDrafts(
  members: KnowledgeMember[],
): Record<string, MemberDraft> {
  return Object.fromEntries(
    members.map((member) => [member.id, { role: member.role ?? "" }]),
  );
}

function countKnowledgeAdmins(members: KnowledgeMember[]): number {
  return members.filter((member) => member.role === "knowledge_admin").length;
}

function roleLabel(
  t: (key: string) => string,
  role: KnowledgeRole | null | "",
): string {
  if (!role) return t("knowledge.members.noRole");
  if (role === "knowledge_admin") {
    return t("knowledge.members.knowledgeAdminBadge");
  }
  return t(`knowledge.members.roles.${role}`);
}

export function KnowledgeMembersClient({
  initialMembers,
  currentUserId,
}: {
  initialMembers: KnowledgeMember[];
  currentUserId: string;
}) {
  const { t } = useTranslation();
  const [members, setMembers] = useState(initialMembers);
  const [drafts, setDrafts] = useState(() => buildDrafts(initialMembers));
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [memberFilter, setMemberFilter] = useState<MemberFilter>("all");
  const [editingMemberId, setEditingMemberId] = useState<string | null>(null);

  const pendingChanges = useMemo(() => {
    return members.filter((member) => {
      const draft = drafts[member.id];
      if (!draft?.role) return false;
      return (draft.role || null) !== (member.role ?? null);
    });
  }, [drafts, members]);

  const hasPendingChanges = pendingChanges.length > 0;
  const adminCount = countKnowledgeAdmins(members);

  const filteredMembers = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return members.filter((member) => {
      if (memberFilter === "unassigned" && member.role) {
        return false;
      }
      if (!query) return true;
      return (
        member.displayName.toLowerCase().includes(query) ||
        member.email.toLowerCase().includes(query)
      );
    });
  }, [memberFilter, members, searchQuery]);

  const editingMember = editingMemberId
    ? members.find((member) => member.id === editingMemberId) ?? null
    : null;

  const loadMembers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/knowledge/roles", {
        cache: "no-store",
      });
      const payload = (await response.json()) as {
        users?: KnowledgeMember[];
        error?: string;
        errorCode?: string;
      };
      if (!response.ok || !payload.users) {
        throw new Error(
          resolveKnowledgeApiError(t, payload, "knowledge.members.loadFailed"),
        );
      }
      setMembers(payload.users);
      setDrafts(buildDrafts(payload.users));
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : t("knowledge.members.loadFailed"),
      );
    } finally {
      setLoading(false);
    }
  }, [t]);

  function isLastAdminLocked(member: KnowledgeMember): boolean {
    return (
      member.id === currentUserId &&
      member.role === "knowledge_admin" &&
      adminCount <= 1
    );
  }

  function isRowEditable(member: KnowledgeMember): boolean {
    return !isLastAdminLocked(member);
  }

  function discardPendingChanges() {
    setDrafts(buildDrafts(members));
    setError(null);
    setSuccess(null);
  }

  function selectRole(memberId: string, role: KnowledgeRole | "") {
    setDrafts((current) => ({
      ...current,
      [memberId]: { role },
    }));
    setEditingMemberId(null);
  }

  async function savePendingChanges() {
    if (!hasPendingChanges || saving) return;
    setSaving(true);
    setError(null);
    setSuccess(null);

    const failures: string[] = [];
    let savedCount = 0;

    for (const member of pendingChanges) {
      const draft = drafts[member.id];
      if (!draft?.role) continue;

      try {
        const response = await fetch("/api/knowledge/roles", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId: member.id, role: draft.role }),
        });
        const payload = (await response.json()) as {
          ok?: boolean;
          error?: string;
          errorCode?: string;
        };
        if (!response.ok || !payload.ok) {
          failures.push(
            resolveKnowledgeApiError(
              t,
              payload,
              "knowledge.members.updateFailed",
            ),
          );
          continue;
        }
        savedCount += 1;
      } catch {
        failures.push(t("knowledge.members.updateFailed"));
      }
    }

    await loadMembers();

    if (failures.length > 0) {
      setError(failures[0]);
      if (savedCount > 0) {
        setSuccess(t("knowledge.members.changesSaved"));
      }
    } else {
      setSuccess(t("knowledge.members.changesSaved"));
    }

    setSaving(false);
  }

  const roleOptions: Array<{ value: KnowledgeRole | ""; label: string }> = [
    { value: "", label: t("knowledge.members.noRole") },
    ...KNOWLEDGE_ROLES.map((role) => ({
      value: role,
      label: roleLabel(t, role),
    })),
  ];

  return (
    <div className="space-y-3 pb-24 md:space-y-4 md:pb-4">
      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
      {success && (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {success}
        </p>
      )}

      <div className="space-y-2">
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
            aria-hidden
          />
          <input
            type="search"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder={t("knowledge.members.searchPlaceholder")}
            aria-label={t("knowledge.members.searchPlaceholder")}
            className="min-h-10 w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm"
          />
        </div>
        <div className="flex gap-2">
          {(["all", "unassigned"] as const).map((filter) => (
            <button
              key={filter}
              type="button"
              className={cn(
                "rounded-full px-3 py-1 text-xs font-medium",
                memberFilter === filter
                  ? "bg-blue-50 text-blue-700"
                  : "border border-slate-200 crm-text-secondary",
              )}
              onClick={() => setMemberFilter(filter)}
            >
              {filter === "all"
                ? t("knowledge.members.filterAll")
                : t("knowledge.members.filterUnassigned")}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <p className="text-sm crm-text-secondary">{t("common.loading")}</p>
      ) : filteredMembers.length === 0 ? (
        <EmptyState message={t("knowledge.members.noMembers")} />
      ) : (
        <div
          className="overflow-hidden rounded-xl border border-slate-200 bg-white"
          data-member-list="true"
        >
          {filteredMembers.map((member, index) => {
            const draft = drafts[member.id] ?? { role: member.role ?? "" };
            const isCurrentUser = member.id === currentUserId;
            const lastAdminLocked = isLastAdminLocked(member);
            const editable = isRowEditable(member);
            const displayRole = draft.role || member.role;
            const roleBadgeLabel = roleLabel(t, displayRole);
            const hasDraftChange =
              (draft.role || null) !== (member.role ?? null);

            return (
              <div
                key={member.id}
                className={cn(
                  "px-3 py-3",
                  index > 0 && "border-t border-slate-100",
                )}
              >
                {editable ? (
                  <button
                    type="button"
                    data-member-row="true"
                    data-member-editable="true"
                    className="flex w-full min-w-0 items-center gap-3 text-left"
                    onClick={() => setEditingMemberId(member.id)}
                    disabled={saving}
                  >
                    <MemberRowContent
                      member={member}
                      isCurrentUser={isCurrentUser}
                      roleBadgeLabel={roleBadgeLabel}
                      hasDraftChange={hasDraftChange}
                      lastAdminLocked={false}
                      t={t}
                    />
                    <ChevronRight
                      className="h-4 w-4 shrink-0 text-slate-400"
                      aria-hidden
                    />
                  </button>
                ) : (
                  <div
                    data-member-row="true"
                    data-member-editable="false"
                    data-sole-admin-protected="true"
                    className="flex w-full min-w-0 items-center gap-3"
                  >
                    <MemberRowContent
                      member={member}
                      isCurrentUser={isCurrentUser}
                      roleBadgeLabel={roleBadgeLabel}
                      hasDraftChange={false}
                      lastAdminLocked={lastAdminLocked}
                      t={t}
                    />
                  </div>
                )}
                {lastAdminLocked && (
                  <p className="mt-1 pl-11 text-xs crm-text-secondary">
                    {t("knowledge.members.soleAdminProtected")}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}

      <KnowledgeMobileSheet
        open={editingMember !== null}
        title={t("knowledge.members.roleChooserTitle")}
        description={
          editingMember
            ? `${editingMember.displayName} · ${editingMember.email}`
            : undefined
        }
        closeLabel={t("knowledge.home.close")}
        onClose={() => setEditingMemberId(null)}
      >
        {editingMember && (
          <div
            className="space-y-1"
            role="listbox"
            aria-label={t("knowledge.members.roleChooserTitle")}
            data-role-chooser="true"
          >
            {roleOptions.map((option) => {
              const selected =
                (drafts[editingMember.id]?.role ?? "") === option.value;
              return (
                <button
                  key={option.value || "none"}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  className={cn(
                    "flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm",
                    selected
                      ? "bg-blue-50 text-blue-700"
                      : "hover:bg-slate-50 crm-text",
                  )}
                  onClick={() =>
                    selectRole(editingMember.id, option.value as KnowledgeRole | "")
                  }
                >
                  <span>{option.label}</span>
                  {selected && (
                    <Check className="h-4 w-4 shrink-0" aria-hidden />
                  )}
                </button>
              );
            })}
          </div>
        )}
      </KnowledgeMobileSheet>

      {hasPendingChanges && (
        <div
          className="fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom,0px)+4.25rem)] z-30 border-t border-slate-200 bg-white/95 px-4 py-2.5 shadow-[0_-4px_16px_rgba(15,23,42,0.08)] backdrop-blur md:static md:bottom-auto md:rounded-xl md:border md:shadow-none"
          data-pending-save-bar="true"
        >
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-medium crm-text">
              {t("knowledge.members.pendingCount", {
                count: String(pendingChanges.length),
              })}
            </p>
            <div className="flex shrink-0 items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="min-h-9"
                onClick={discardPendingChanges}
                disabled={saving}
              >
                {t("knowledge.members.cancelChanges")}
              </Button>
              <Button
                type="button"
                size="sm"
                className="min-h-9"
                onClick={() => void savePendingChanges()}
                disabled={saving}
              >
                {saving
                  ? t("knowledge.members.savingChanges")
                  : t("knowledge.members.saveChanges")}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MemberRowContent({
  member,
  isCurrentUser,
  roleBadgeLabel,
  hasDraftChange,
  lastAdminLocked,
  t,
}: {
  member: KnowledgeMember;
  isCurrentUser: boolean;
  roleBadgeLabel: string;
  hasDraftChange: boolean;
  lastAdminLocked: boolean;
  t: (key: string) => string;
}) {
  const initials = knowledgeDisplayInitials(member.displayName);

  return (
    <>
      <div
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600"
        aria-hidden
      >
        {initials}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <p className="truncate text-sm font-medium crm-text">
            {member.displayName}
          </p>
          {isCurrentUser && (
            <span
              className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium crm-text-secondary"
              data-you-badge="true"
            >
              {t("knowledge.members.youBadge")}
            </span>
          )}
        </div>
        <p className="truncate text-xs crm-text-secondary">{member.email}</p>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <Badge
          variant={member.role || hasDraftChange ? "success" : "warning"}
          className="max-w-[7.5rem] truncate"
        >
          {roleBadgeLabel}
        </Badge>
        {lastAdminLocked && (
          <Lock className="h-3.5 w-3.5 text-slate-500" aria-hidden />
        )}
      </div>
    </>
  );
}
