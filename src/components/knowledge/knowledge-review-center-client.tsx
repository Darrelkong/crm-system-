"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "@/i18n/provider";
import { Badge, Card, EmptyState } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  formatAssignedReviewerLabel,
  formatKnowledgeReviewStatus,
  formatKnowledgeVisibility,
} from "@/lib/knowledge/review-labels";
import type { KnowledgeRole } from "../../../drizzle/schema/knowledge-user-roles";
import type {
  KnowledgeReviewDetail,
  KnowledgeReviewListItem,
} from "@/lib/knowledge/review-service";
import { resolveKnowledgeApiError } from "@/lib/knowledge/error-messages";

type Tab = "pending" | "mine" | "history";

export function KnowledgeReviewCenterClient({
  initialPending,
  initialMine,
  initialHistory,
  role,
  userId,
  reviewerOptions,
}: {
  initialPending: KnowledgeReviewListItem[];
  initialMine: KnowledgeReviewListItem[];
  initialHistory: KnowledgeReviewListItem[];
  role: KnowledgeRole;
  userId: string;
  reviewerOptions: Array<{
    id: string;
    displayName: string;
    role: KnowledgeRole | null;
  }>;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>(
    role === "reviewer" || role === "knowledge_admin" ? "pending" : "mine",
  );
  const [lists, setLists] = useState({
    pending: initialPending,
    mine: initialMine,
    history: initialHistory,
  });
  const [selected, setSelected] = useState<KnowledgeReviewDetail | null>(null);
  const [reviewNote, setReviewNote] = useState("");
  const [reviewerId, setReviewerId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmPublish, setConfirmPublish] = useState(false);
  const [renderedAt] = useState(() => Date.now());

  const tabLabels: Record<Tab, string> = {
    pending: t("knowledge.review.pending"),
    mine: t("knowledge.review.mine"),
    history: t("knowledge.review.history"),
  };

  function dueLabel(dueAt: string | null): string {
    if (!dueAt) return "";
    const due = Date.parse(dueAt);
    if (!Number.isFinite(due)) return "";
    if (due < renderedAt) return t("knowledge.review.dueOverdue");
    if (due - renderedAt < 48 * 60 * 60 * 1000) {
      return t("knowledge.review.dueSoon");
    }
    return t("knowledge.review.dueNormal");
  }

  const currentList = useMemo(() => lists[tab], [lists, tab]);
  const visibleTabs = useMemo(
    () =>
      role === "contributor"
        ? (["mine", "history"] as const)
        : (["pending", "mine", "history"] as const),
    [role],
  );

  async function refreshTab(nextTab = tab) {
    const response = await fetch(`/api/knowledge/review?view=${nextTab}`, {
      cache: "no-store",
    });
    const payload = (await response.json()) as {
      reviews?: KnowledgeReviewListItem[];
      error?: string;
      errorCode?: string;
    };
    if (!response.ok || !payload.reviews) {
      throw new Error(
        resolveKnowledgeApiError(t, payload, "knowledge.review.loadListFailed"),
      );
    }
    setLists((current) => ({ ...current, [nextTab]: payload.reviews! }));
  }

  async function openReview(id: string) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/knowledge/review/${id}`, {
        cache: "no-store",
      });
      const payload = (await response.json()) as {
        review?: KnowledgeReviewDetail;
        error?: string;
        errorCode?: string;
      };
      if (!response.ok || !payload.review) {
        throw new Error(
          resolveKnowledgeApiError(t, payload, "knowledge.review.loadDetailFailed"),
        );
      }
      setSelected(payload.review);
      setReviewNote("");
      setReviewerId(payload.review.assignedReviewerUserId ?? "");
      setConfirmPublish(false);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : t("knowledge.review.loadDetailFailed"),
      );
    } finally {
      setBusy(false);
    }
  }

  async function action(
    actionName: "request_changes" | "approve_publish" | "withdraw" | "assign",
  ) {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/knowledge/review/${selected.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: actionName,
          ...(actionName === "request_changes" ? { reviewNote } : {}),
          ...(actionName === "assign" ? { reviewerUserId: reviewerId } : {}),
        }),
      });
      const payload = (await response.json()) as {
        review?: KnowledgeReviewDetail;
        error?: string;
        errorCode?: string;
      };
      if (!response.ok || !payload.review) {
        throw new Error(
          resolveKnowledgeApiError(t, payload, "knowledge.review.actionFailed"),
        );
      }
      setSelected(payload.review);
      setConfirmPublish(false);
      await refreshTab(tab);
      if (actionName !== "approve_publish") router.refresh();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : t("knowledge.review.actionFailed"),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(16rem,24rem)_minmax(0,1fr)]">
      <section className="min-w-0 space-y-4">
        <div className="flex flex-wrap gap-2">
          {visibleTabs.map((name) => (
            <Button
              key={name}
              type="button"
              size="sm"
              variant={tab === name ? "primary" : "secondary"}
              onClick={() => {
                setTab(name);
                void refreshTab(name).catch((caught: unknown) =>
                  setError(
                    caught instanceof Error
                      ? caught.message
                      : t("knowledge.review.loadListFailed"),
                  ),
                );
              }}
            >
              {tabLabels[name]}
            </Button>
          ))}
        </div>
        {currentList.length === 0 ? (
          <EmptyState message={t("knowledge.review.emptyList")} />
        ) : (
          <div className="space-y-3">
            {currentList.map((review) => (
              <button
                key={review.id}
                type="button"
                onClick={() => void openReview(review.id)}
                className="w-full rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm hover:bg-slate-50"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-semibold crm-text">
                      {review.articleTitle}
                    </p>
                    <p className="mt-1 text-xs crm-text-secondary">
                      Version {review.submittedVersionNumber} ·{" "}
                      {review.submittedByName}
                    </p>
                  </div>
                  <Badge
                    variant={
                      review.status === "pending"
                        ? "warning"
                        : review.status === "approved"
                          ? "success"
                          : review.status === "changes_requested"
                            ? "warning"
                            : "default"
                    }
                  >
                    {formatKnowledgeReviewStatus(review.status, t)}
                  </Badge>
                </div>
                <p className="mt-2 text-xs crm-text-secondary">
                  {formatKnowledgeVisibility(review.visibility, t)} ·{" "}
                  {new Date(review.submittedAt).toLocaleString()}
                  {review.dueAt && ` · ${dueLabel(review.dueAt)}`}
                </p>
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="min-w-0">
        {selected ? (
          <Card>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">
                  {t("knowledge.review.exactVersion", {
                    version: String(selected.submittedVersionNumber),
                  })}
                </p>
                <h2 className="mt-1 text-xl font-semibold crm-text">
                  {selected.titleSnapshot}
                </h2>
              </div>
              <div className="flex flex-wrap gap-2">
                <Link
                  href={`/knowledge/articles/${selected.articleId}`}
                  className="secondary-button inline-flex min-h-9 items-center rounded-xl px-3 py-2 text-sm"
                >
                  {t("knowledge.review.viewArticle")}
                </Link>
                <Badge variant={selected.status === "pending" ? "warning" : "default"}>
                  {formatKnowledgeReviewStatus(selected.status, t)}
                </Badge>
              </div>
            </div>
            <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="crm-text-secondary">
                  {t("knowledge.review.submittedBy")}
                </dt>
                <dd className="crm-text">{selected.submittedByName}</dd>
              </div>
              <div>
                <dt className="crm-text-secondary">
                  {t("knowledge.review.submittedAt")}
                </dt>
                <dd className="crm-text">
                  {new Date(selected.submittedAt).toLocaleString()}
                </dd>
              </div>
              <div>
                <dt className="crm-text-secondary">
                  {t("knowledge.review.visibilityLabel")}
                </dt>
                <dd className="crm-text">
                  {formatKnowledgeVisibility(selected.visibility, t)}
                </dd>
              </div>
              <div>
                <dt className="crm-text-secondary">
                  {t("knowledge.review.categoryLabel")}
                </dt>
                <dd className="crm-text">{selected.categoryName}</dd>
              </div>
              <div>
                <dt className="crm-text-secondary">
                  {t("knowledge.review.reviewerLabel")}
                </dt>
                <dd className="crm-text">
                  {formatAssignedReviewerLabel(selected.assignedReviewerName, t)}
                </dd>
              </div>
            </dl>
            {selected.status === "pending" && !selected.assignedReviewerName && (
              <p className="mt-3 text-xs crm-text-secondary">
                {t("knowledge.review.unassignedQueueHint")}
              </p>
            )}
            {selected.submissionNote && (
              <p className="mt-5 rounded-xl bg-slate-50 p-4 text-sm crm-text-secondary">
                {t("knowledge.review.submissionNoteLabel", {
                  note: selected.submissionNote,
                })}
              </p>
            )}
            {selected.summarySnapshot && (
              <p className="mt-3 rounded-xl bg-slate-50 p-4 text-sm crm-text-secondary">
                {t("knowledge.review.summaryLabel", {
                  summary: selected.summarySnapshot,
                })}
              </p>
            )}
            {selected.reviewNote && (
              <p className="mt-3 rounded-xl bg-amber-50 p-4 text-sm text-amber-900">
                {t("knowledge.review.reviewNoteLabel", {
                  note: selected.reviewNote,
                })}
              </p>
            )}
            <article className="mt-6 whitespace-pre-wrap break-words text-sm leading-8 crm-text">
              {selected.bodySnapshot}
            </article>

            {role === "knowledge_admin" && selected.status === "pending" && (
              <div className="mt-6 border-t border-slate-200 pt-5">
                <label className="block text-sm font-medium crm-text">
                  {t("knowledge.review.assignReviewer")}
                  <select
                    value={reviewerId}
                    onChange={(event) => setReviewerId(event.target.value)}
                    className="mt-2 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3"
                  >
                    <option value="">{t("knowledge.review.selectOption")}</option>
                    {reviewerOptions
                      .filter(
                        (option) =>
                          option.id !== selected.submittedByUserId &&
                          (option.role === "reviewer" ||
                            option.role === "knowledge_admin"),
                      )
                      .map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.displayName} · {option.role}
                        </option>
                      ))}
                  </select>
                </label>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  className="mt-3"
                  onClick={() => void action("assign")}
                  disabled={busy || !reviewerId}
                >
                  {t("knowledge.review.assignReview")}
                </Button>
              </div>
            )}

            {selected.status === "pending" &&
              selected.submittedByUserId !== userId &&
              (role === "reviewer" || role === "knowledge_admin") && (
                <div className="mt-6 border-t border-slate-200 pt-5">
                  <label className="block text-sm font-medium crm-text">
                    {t("knowledge.review.changesNoteLabel")}
                    <textarea
                      value={reviewNote}
                      onChange={(event) => setReviewNote(event.target.value)}
                      rows={4}
                      maxLength={2_000}
                      className="mt-2 w-full rounded-xl border border-slate-200 bg-white p-3 text-sm"
                    />
                  </label>
                  {confirmPublish ? (
                    <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-4">
                      <p className="text-sm text-red-950">
                        {t("knowledge.review.confirmPublishPrompt", {
                          title: selected.titleSnapshot,
                          version: String(selected.submittedVersionNumber),
                          visibility: formatKnowledgeVisibility(
                            selected.visibility,
                            t,
                          ),
                        })}
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button
                          type="button"
                          onClick={() => void action("approve_publish")}
                          disabled={busy}
                        >
                          {t("knowledge.review.confirmApprovePublish")}
                        </Button>
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={() => setConfirmPublish(false)}
                          disabled={busy}
                        >
                          {t("knowledge.review.cancel")}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="danger"
                        onClick={() => void action("request_changes")}
                        disabled={busy || reviewNote.trim().length < 2}
                      >
                        {t("knowledge.review.requestChanges")}
                      </Button>
                      <Button
                        type="button"
                        onClick={() => setConfirmPublish(true)}
                        disabled={busy}
                      >
                        {t("knowledge.review.approvePublish")}
                      </Button>
                    </div>
                  )}
                </div>
              )}

            {selected.status === "pending" &&
              (selected.submittedByUserId === userId ||
                role === "knowledge_admin") && (
                <Button
                  type="button"
                  variant="secondary"
                  className="mt-6"
                  onClick={() => void action("withdraw")}
                  disabled={busy}
                >
                  {t("knowledge.review.withdraw")}
                </Button>
              )}
            {error && (
              <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">
                {error}
              </p>
            )}
          </Card>
        ) : (
          <EmptyState message={t("knowledge.review.emptySelection")} />
        )}
      </section>
    </div>
  );
}
