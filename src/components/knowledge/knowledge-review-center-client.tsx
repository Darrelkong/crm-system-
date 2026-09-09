"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Card, EmptyState } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { KnowledgeRole } from "../../../drizzle/schema/knowledge-user-roles";
import type {
  KnowledgeReviewDetail,
  KnowledgeReviewListItem,
} from "@/lib/knowledge/review-service";

type Tab = "pending" | "mine" | "history";

function dueLabel(dueAt: string | null): string {
  if (!dueAt) return "";
  const due = Date.parse(dueAt);
  if (!Number.isFinite(due)) return "";
  return due < Date.now() ? "已逾期" : due - Date.now() < 48 * 60 * 60 * 1000 ? "即将到期" : "正常";
}

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

  const currentList = useMemo(() => lists[tab], [lists, tab]);

  async function refreshTab(nextTab = tab) {
    const response = await fetch(`/api/knowledge/review?view=${nextTab}`, {
      cache: "no-store",
    });
    const payload = (await response.json()) as {
      reviews?: KnowledgeReviewListItem[];
      error?: string;
    };
    if (!response.ok || !payload.reviews) {
      throw new Error(payload.error ?? "审核列表载入失败");
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
      };
      if (!response.ok || !payload.review) {
        throw new Error(payload.error ?? "审核记录载入失败");
      }
      setSelected(payload.review);
      setReviewNote("");
      setReviewerId(payload.review.assignedReviewerUserId ?? "");
      setConfirmPublish(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "审核记录载入失败");
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
      };
      if (!response.ok || !payload.review) {
        throw new Error(payload.error ?? "审核操作失败");
      }
      setSelected(payload.review);
      setConfirmPublish(false);
      await refreshTab(tab);
      if (actionName !== "approve_publish") router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "审核操作失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(16rem,24rem)_minmax(0,1fr)]">
      <section className="min-w-0 space-y-4">
        <div className="flex flex-wrap gap-2">
          {(["pending", "mine", "history"] as const).map((name) => (
            <Button
              key={name}
              type="button"
              size="sm"
              variant={tab === name ? "primary" : "secondary"}
              onClick={() => {
                setTab(name);
                void refreshTab(name).catch((caught: unknown) =>
                  setError(caught instanceof Error ? caught.message : "审核列表载入失败"),
                );
              }}
            >
              {name === "pending"
                ? "待审核"
                : name === "mine"
                  ? "我提交的"
                  : "历史记录"}
            </Button>
          ))}
        </div>
        {currentList.length === 0 ? (
          <EmptyState message="目前没有审核记录。" />
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
                          : "default"
                    }
                  >
                    {review.status}
                  </Badge>
                </div>
                <p className="mt-2 text-xs crm-text-secondary">
                  {review.visibility} ·{" "}
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
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">
                  正在审核 Version {selected.submittedVersionNumber}
                </p>
                <h2 className="mt-1 text-xl font-semibold crm-text">
                  {selected.titleSnapshot}
                </h2>
              </div>
              <Badge variant={selected.status === "pending" ? "warning" : "default"}>
                {selected.status}
              </Badge>
            </div>
            <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="crm-text-secondary">提交者</dt>
                <dd className="crm-text">{selected.submittedByName}</dd>
              </div>
              <div>
                <dt className="crm-text-secondary">提交时间</dt>
                <dd className="crm-text">
                  {new Date(selected.submittedAt).toLocaleString()}
                </dd>
              </div>
              <div>
                <dt className="crm-text-secondary">可见范围</dt>
                <dd className="crm-text">{selected.visibility}</dd>
              </div>
              <div>
                <dt className="crm-text-secondary">分类</dt>
                <dd className="crm-text">{selected.categoryName}</dd>
              </div>
              <div>
                <dt className="crm-text-secondary">Reviewer</dt>
                <dd className="crm-text">
                  {selected.assignedReviewerName ?? "未分配"}
                </dd>
              </div>
            </dl>
            {selected.submissionNote && (
              <p className="mt-5 rounded-xl bg-slate-50 p-4 text-sm crm-text-secondary">
                提交说明：{selected.submissionNote}
              </p>
            )}
            {selected.summarySnapshot && (
              <p className="mt-3 rounded-xl bg-slate-50 p-4 text-sm crm-text-secondary">
                摘要：{selected.summarySnapshot}
              </p>
            )}
            {selected.reviewNote && (
              <p className="mt-3 rounded-xl bg-amber-50 p-4 text-sm text-amber-900">
                审核意见：{selected.reviewNote}
              </p>
            )}
            <article className="mt-6 whitespace-pre-wrap break-words text-sm leading-8 crm-text">
              {selected.bodySnapshot}
            </article>

            {role === "knowledge_admin" && selected.status === "pending" && (
              <div className="mt-6 border-t border-slate-200 pt-5">
                <label className="block text-sm font-medium crm-text">
                  分配 Reviewer
                  <select
                    value={reviewerId}
                    onChange={(event) => setReviewerId(event.target.value)}
                    className="mt-2 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3"
                  >
                    <option value="">请选择</option>
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
                  分配审核
                </Button>
              </div>
            )}

            {selected.status === "pending" &&
              selected.submittedByUserId !== userId &&
              (role === "reviewer" || role === "knowledge_admin") && (
                <div className="mt-6 border-t border-slate-200 pt-5">
                  <label className="block text-sm font-medium crm-text">
                    要求修改说明
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
                        确认发布「{selected.titleSnapshot}」Version{" "}
                        {selected.submittedVersionNumber}？
                        可见范围：{selected.visibility}
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button
                          type="button"
                          onClick={() => void action("approve_publish")}
                          disabled={busy}
                        >
                          确认批准并发布
                        </Button>
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={() => setConfirmPublish(false)}
                          disabled={busy}
                        >
                          取消
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
                        要求修改
                      </Button>
                      <Button
                        type="button"
                        onClick={() => setConfirmPublish(true)}
                        disabled={busy}
                      >
                        批准并发布
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
                  撤回审核
                </Button>
              )}
            {error && (
              <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">
                {error}
              </p>
            )}
          </Card>
        ) : (
          <EmptyState message="请选择一项审核记录查看固定版本内容。" />
        )}
      </section>
    </div>
  );
}
