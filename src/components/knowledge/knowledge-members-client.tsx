"use client";

import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "@/i18n/provider";
import { Button } from "@/components/ui/button";
import { Badge, Card, EmptyState } from "@/components/ui/card";
import type { KnowledgeRole } from "../../../drizzle/schema/knowledge-user-roles";
import { KNOWLEDGE_ROLES } from "@/lib/knowledge/constants";
import { resolveKnowledgeApiError } from "@/lib/knowledge/error-messages";

type KnowledgeMember = {
  id: string;
  email: string;
  displayName: string;
  role: KnowledgeRole | null;
};

type MemberDraft = {
  role: KnowledgeRole | "";
};

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

  const pendingChanges = useMemo(() => {
    return members.filter((member) => {
      const draft = drafts[member.id];
      if (!draft?.role) return false;
      return (draft.role || null) !== (member.role ?? null);
    });
  }, [drafts, members]);

  const hasPendingChanges = pendingChanges.length > 0;
  const adminCount = countKnowledgeAdmins(members);

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

  return (
    <div className="space-y-4 pb-4 md:space-y-6">
      {error && (
        <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      )}
      {success && (
        <p className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {success}
        </p>
      )}

      {hasPendingChanges && (
        <p className="text-sm font-medium text-amber-800">
          {t("knowledge.members.unsavedChanges")}
        </p>
      )}

      {loading ? (
        <p className="text-sm crm-text-secondary">{t("common.loading")}</p>
      ) : members.length === 0 ? (
        <EmptyState message={t("knowledge.members.noMembers")} />
      ) : (
        <div className="space-y-2">
          {members.map((member) => {
            const draft = drafts[member.id] ?? { role: member.role ?? "" };
            const isCurrentUser = member.id === currentUserId;
            const lastAdminLocked = isLastAdminLocked(member);
            const displayRole = member.role;
            const roleBadgeLabel = displayRole
              ? displayRole === "knowledge_admin"
                ? t("knowledge.members.knowledgeAdminBadge")
                : t(`knowledge.members.roles.${displayRole}`)
              : t("knowledge.members.noRole");

            return (
              <Card
                key={member.id}
                className="min-w-0 p-3 sm:p-4"
              >
                <div className="flex flex-col gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <h2 className="truncate text-sm font-semibold crm-text sm:text-base">
                        {member.displayName}
                      </h2>
                      {isCurrentUser && (
                        <Badge variant="default">
                          {t("knowledge.members.youBadge")}
                        </Badge>
                      )}
                      <Badge
                        variant={member.role ? "success" : "warning"}
                      >
                        {roleBadgeLabel}
                      </Badge>
                    </div>
                    <p className="mt-0.5 break-all text-xs crm-text-secondary sm:text-sm">
                      {member.email}
                    </p>
                  </div>

                  <label className="block text-xs font-medium crm-text sm:text-sm">
                    {t("knowledge.members.knowledgeRole")}
                    <select
                      value={draft.role}
                      onChange={(event) =>
                        setDrafts((current) => ({
                          ...current,
                          [member.id]: {
                            role: event.target.value as KnowledgeRole | "",
                          },
                        }))
                      }
                      className="mt-1.5 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm"
                      disabled={saving || lastAdminLocked}
                      aria-describedby={
                        lastAdminLocked
                          ? `last-admin-hint-${member.id}`
                          : undefined
                      }
                    >
                      <option value="">
                        {t("knowledge.members.noRole")}
                      </option>
                      {KNOWLEDGE_ROLES.map((role) => (
                        <option key={role} value={role}>
                          {role === "knowledge_admin"
                            ? t("knowledge.members.knowledgeAdminBadge")
                            : t(`knowledge.members.roles.${role}`)}
                        </option>
                      ))}
                    </select>
                  </label>
                  {lastAdminLocked && (
                    <p
                      id={`last-admin-hint-${member.id}`}
                      className="text-xs crm-text-secondary"
                    >
                      {t("knowledge.members.lastAdminReadonly")}
                    </p>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {hasPendingChanges && (
        <div
          className="sticky bottom-0 z-30 -mx-1 border-t border-slate-200 bg-white/95 px-1 py-3 backdrop-blur md:static md:mx-0 md:rounded-xl md:border md:px-4"
        >
          <Button
            type="button"
            className="min-h-11 w-full md:w-auto"
            onClick={() => void savePendingChanges()}
            disabled={saving || !hasPendingChanges}
          >
            {saving
              ? t("knowledge.members.savingChanges")
              : t("knowledge.members.saveChanges")}
          </Button>
        </div>
      )}
    </div>
  );
}
