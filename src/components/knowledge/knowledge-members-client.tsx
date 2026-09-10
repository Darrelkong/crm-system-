"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { useTranslation } from "@/i18n/provider";
import { Button } from "@/components/ui/button";
import { Badge, Card, EmptyState } from "@/components/ui/card";
import type { KnowledgeRole } from "../../../drizzle/schema/knowledge-user-roles";
import { KNOWLEDGE_ROLES } from "@/lib/knowledge/constants";

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

export function KnowledgeMembersClient({
  initialMembers,
}: {
  initialMembers: KnowledgeMember[];
}) {
  const { t } = useTranslation();
  const [members, setMembers] = useState(initialMembers);
  const [drafts, setDrafts] = useState(() => buildDrafts(initialMembers));
  const [loading, setLoading] = useState(false);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

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
      };
      if (!response.ok || !payload.users) {
        throw new Error(payload.error ?? t("knowledge.members.loadFailed"));
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

  async function saveRole(userId: string) {
    const draft = drafts[userId];
    if (!draft?.role) return;
    setBusyUserId(userId);
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch("/api/knowledge/roles", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, role: draft.role }),
      });
      const payload = (await response.json()) as {
        ok?: boolean;
        error?: string;
        errorCode?: string;
      };
      if (!response.ok || !payload.ok) {
        if (payload.errorCode === "KNOWLEDGE_LAST_ADMIN") {
          throw new Error(t("knowledge.members.lastAdminError"));
        }
        throw new Error(payload.error ?? t("knowledge.members.updateFailed"));
      }
      setSuccess(t("knowledge.members.roleSaved"));
      await loadMembers();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : t("knowledge.members.updateFailed"),
      );
    } finally {
      setBusyUserId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm crm-text-secondary">
          {t("knowledge.members.description")}
        </p>
        <Link
          href="/knowledge"
          className="secondary-button inline-flex min-h-11 items-center justify-center rounded-xl px-4 py-2.5 text-sm font-medium transition-all duration-200 ease-out"
        >
          {t("knowledge.members.backToKnowledge")}
        </Link>
      </div>

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

      {loading ? (
        <p className="text-sm crm-text-secondary">{t("common.loading")}</p>
      ) : members.length === 0 ? (
        <EmptyState message={t("knowledge.members.noMembers")} />
      ) : (
        <div className="grid gap-4">
          {members.map((member) => {
            const draft = drafts[member.id] ?? { role: member.role ?? "" };
            const hasRoleChange =
              (draft.role || null) !== (member.role ?? null);
            const isBusy = busyUserId === member.id;
            return (
              <Card key={member.id} className="min-w-0 p-4 sm:p-5">
                <div className="flex flex-col gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="truncate text-base font-semibold crm-text">
                        {member.displayName}
                      </h2>
                      <Badge variant={member.role ? "success" : "warning"}>
                        {member.role
                          ? t(`knowledge.members.roles.${member.role}`)
                          : t("knowledge.members.noRole")}
                      </Badge>
                    </div>
                    <p className="mt-1 break-all text-sm crm-text-secondary">
                      {member.email}
                    </p>
                  </div>

                  <label className="block text-sm font-medium crm-text">
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
                      className="mt-2 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm"
                      disabled={isBusy}
                    >
                      <option value="">
                        {t("knowledge.members.noRole")}
                      </option>
                      {KNOWLEDGE_ROLES.map((role) => (
                        <option key={role} value={role}>
                          {t(`knowledge.members.roles.${role}`)}
                        </option>
                      ))}
                    </select>
                  </label>

                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => void saveRole(member.id)}
                      disabled={!draft.role || !hasRoleChange || isBusy}
                    >
                      {isBusy
                        ? t("knowledge.members.savingRole")
                        : t("knowledge.members.saveRole")}
                    </Button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
