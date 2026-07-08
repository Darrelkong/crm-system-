"use client";

import { useCallback, useEffect, useState } from "react";
import { Star } from "lucide-react";
import { useCustomerLabels } from "@/i18n/use-customer-labels";
import type { CustomerAiInsightView } from "@/lib/ai/customer-insights/service";
import type { AiInsightFeedbackReasonTag } from "../../../drizzle/schema/ai-insight-feedback";
import { ui } from "@/lib/ui/classes";

const cd = ui.customerDetail;

const QUICK_RATING_OPTIONS = [
  { key: "helpful" as const, rating: 5 },
  { key: "neutral" as const, rating: 3 },
  { key: "notHelpful" as const, rating: 1 },
];

const REASON_TAG_KEYS: AiInsightFeedbackReasonTag[] = [
  "inaccurate_intent",
  "next_action_too_generic",
  "robotic_message",
  "missed_customer_pain_point",
  "too_long",
  "too_short",
  "other",
];

type FeedbackView = {
  id: string;
  rating: number;
  reasonTags: AiInsightFeedbackReasonTag[];
  comment: string | null;
  insightGeneratedAt: string;
};

type Props = {
  customerId: string;
  insight: CustomerAiInsightView;
};

export function CustomerAiInsightFeedback({ customerId, insight }: Props) {
  const { t } = useCustomerLabels();
  const [feedback, setFeedback] = useState<FeedbackView | null>(null);
  const [rating, setRating] = useState<number>(0);
  const [reasonTags, setReasonTags] = useState<AiInsightFeedbackReasonTag[]>([]);
  const [comment, setComment] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  const loadFeedback = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/customers/${customerId}/ai-insight-feedback`);
      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        throw new Error(data.error ?? t("customers.aiInsightFeedback.loadFailed"));
      }
      const data = (await response.json()) as { feedback: FeedbackView | null };
      setFeedback(data.feedback);
      if (data.feedback) {
        setRating(data.feedback.rating);
        setReasonTags(data.feedback.reasonTags);
        setComment(data.feedback.comment ?? "");
      } else {
        setRating(0);
        setReasonTags([]);
        setComment("");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("customers.aiInsightFeedback.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [customerId, t]);

  useEffect(() => {
    void loadFeedback();
  }, [loadFeedback, insight.generatedAt]);

  function toggleReasonTag(tag: AiInsightFeedbackReasonTag) {
    setReasonTags((current) =>
      current.includes(tag) ? current.filter((item) => item !== tag) : [...current, tag],
    );
    setSavedMessage(null);
  }

  async function handleSave() {
    if (rating < 1 || rating > 5) {
      setError(t("customers.aiInsightFeedback.ratingRequired"));
      return;
    }

    setSaving(true);
    setError(null);
    setSavedMessage(null);
    try {
      const response = await fetch(`/api/customers/${customerId}/ai-insight-feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          insightGeneratedAt: insight.generatedAt,
          rating,
          reasonTags,
          comment: comment.trim() || null,
        }),
      });
      const data = (await response.json()) as {
        feedback?: FeedbackView;
        created?: boolean;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(data.error ?? t("customers.aiInsightFeedback.saveFailed"));
      }
      if (data.feedback) {
        setFeedback(data.feedback);
        setRating(data.feedback.rating);
        setReasonTags(data.feedback.reasonTags);
        setComment(data.feedback.comment ?? "");
      }
      setSavedMessage(t("customers.aiInsightFeedback.saved"));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("customers.aiInsightFeedback.saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  const hasExistingFeedback = feedback !== null;
  const showLowScoreReasons = rating > 0 && rating <= 3;
  const showReasonTagsHint = rating > 0 && rating <= 2 && reasonTags.length === 0;

  function selectRating(value: number) {
    setRating(value);
    setSavedMessage(null);
  }

  function quickOptionSelected(optionRating: number): boolean {
    return rating === optionRating;
  }

  return (
    <div className="mt-6 border-t border-[var(--color-crm-border-subtle)] pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className={cd.sectionTitle}>{t("customers.aiInsightFeedback.title")}</h4>
        {hasExistingFeedback && !loading && (
          <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-800 ring-1 ring-emerald-200">
            {t("customers.aiInsightFeedback.alreadyRated")}
          </span>
        )}
      </div>
      <p className={`mt-1 text-xs ${cd.muted}`}>{t("customers.aiInsightFeedback.adminOnly")}</p>

      {loading && (
        <p className={`mt-3 text-sm ${cd.muted}`}>{t("customers.aiInsightFeedback.loading")}</p>
      )}

      {!loading && error && (
        <p className="mt-3 text-sm text-red-600">{error}</p>
      )}

      {!loading && !error && (
        <div className="mt-4 space-y-4">
          <div>
            <p className={`text-sm font-medium ${cd.label}`}>
              {t("customers.aiInsightFeedback.prompt")}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {QUICK_RATING_OPTIONS.map((option) => {
                const selected = quickOptionSelected(option.rating);
                return (
                  <button
                    key={option.key}
                    type="button"
                    disabled={saving}
                    onClick={() => selectRating(option.rating)}
                    className={`rounded-full px-4 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${
                      selected
                        ? "bg-slate-800 text-white"
                        : "bg-slate-100 text-slate-700 ring-1 ring-slate-200 hover:bg-slate-200"
                    }`}
                  >
                    {t(`customers.aiInsightFeedback.quickOptions.${option.key}`)}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <p className={`text-xs font-medium ${cd.label}`}>
              {t("customers.aiInsightFeedback.ratingLabel")}
            </p>
            <div className="mt-2 flex items-center gap-1">
              {[1, 2, 3, 4, 5].map((value) => {
                const active = value <= rating;
                return (
                  <button
                    key={value}
                    type="button"
                    aria-label={`${value}`}
                    disabled={saving}
                    onClick={() => selectRating(value)}
                    className="rounded p-1 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Star
                      className={`h-6 w-6 ${
                        active
                          ? "fill-amber-400 text-amber-400"
                          : "text-slate-300"
                      }`}
                    />
                  </button>
                );
              })}
            </div>
          </div>

          {showLowScoreReasons && (
            <div>
              <p className={`text-xs font-medium ${cd.label}`}>
                {t("customers.aiInsightFeedback.reasonTagsLabel")}
              </p>
              {showReasonTagsHint && (
                <p className={`mt-1 text-xs ${cd.muted}`}>
                  {t("customers.aiInsightFeedback.reasonTagsHint")}
                </p>
              )}
              <div className="mt-2 flex flex-wrap gap-2">
                {REASON_TAG_KEYS.map((tag) => {
                  const selected = reasonTags.includes(tag);
                  return (
                    <button
                      key={tag}
                      type="button"
                      disabled={saving}
                      onClick={() => toggleReasonTag(tag)}
                      className={`rounded-full px-3 py-1 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${
                        selected
                          ? "bg-slate-800 text-white"
                          : "bg-slate-100 text-slate-700 ring-1 ring-slate-200 hover:bg-slate-200"
                      }`}
                    >
                      {t(`customers.aiInsightFeedback.reasonTags.${tag}`)}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div>
            <label className={`text-xs font-medium ${cd.label}`} htmlFor={`ai-feedback-comment-${customerId}`}>
              {t("customers.aiInsightFeedback.commentLabel")}
            </label>
            <textarea
              id={`ai-feedback-comment-${customerId}`}
              value={comment}
              disabled={saving}
              maxLength={500}
              rows={3}
              onChange={(event) => {
                setComment(event.target.value);
                setSavedMessage(null);
              }}
              className="mt-2 w-full rounded-lg border border-[var(--color-crm-border-subtle)] bg-transparent px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
              placeholder={t("customers.aiInsightFeedback.commentPlaceholder")}
            />
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={saving || rating < 1}
              onClick={() => void handleSave()}
              className="customer-detail-action-btn px-3 py-1.5 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving
                ? t("customers.aiInsightFeedback.saving")
                : hasExistingFeedback
                  ? t("customers.aiInsightFeedback.updateRating")
                  : t("customers.aiInsightFeedback.saveRating")}
            </button>
            {savedMessage && (
              <p className="text-sm text-emerald-700">{savedMessage}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
