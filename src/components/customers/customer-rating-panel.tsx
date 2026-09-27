"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "@/i18n/provider";
import { resolveApiError } from "@/i18n/resolve-api-error";
import { CUSTOMER_RATINGS, type CustomerRatingValue } from "@/lib/customers/rating/domain";
import { createRatingCorrectionFlight, newerRatingReference, readRatingReference, validCorrectionSelection, type RatingReference } from "@/lib/customers/rating/correction-client";
import { CustomerRatingBadge } from "./customer-rating-badge";
import { Button } from "@/components/ui/button";
import { Label, Select, Textarea } from "@/components/ui/form";
export function CustomerRatingPanel({ customerId, rating, revision, canCorrect }: {
  customerId: string; rating: CustomerRatingValue; revision: number; canCorrect: boolean;
}) {
  const { t } = useTranslation(), router = useRouter();
  const [reference, setReference] = useState<RatingReference>({ customerRating: rating, customerRatingRevision: revision });
  const current = newerRatingReference(reference, { customerRating: rating, customerRatingRevision: revision });
  const [open, setOpen] = useState(false), [selection, setSelection] = useState(""), [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const flight = useRef(createRatingCorrectionFlight());
  const active = useRef(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (active.current || !canCorrect) return;
    if (!validCorrectionSelection(selection, reason)) { setError(t("customerRating.validation")); return; }
    active.current = true; setBusy(true); setError(null);
    try {
      const response = await flight.current.submit(customerId, { rating: selection === "unrated" ? null : selection as CustomerRatingValue,
        expectedRevision: current.customerRatingRevision, reason });
      if (!response) return;
      const data = await response.json() as Record<string, unknown>;
      const next = readRatingReference(data);
      if (response.ok && next) {
        setReference(newerRatingReference(current, next)); setOpen(false); setSelection(""); setReason(""); router.refresh();
      } else if (response.status === 409 && data.errorCode === "CUSTOMER_RATING_STALE" && next) {
        setReference(newerRatingReference(current, next)); setError(t("customerRating.stale"));
        // Retain selection/reason. Only another explicit submit can confirm this revision.
      } else { setError(resolveApiError(t, data)); }
    } catch { setError(t("common.networkError")); }
    finally { active.current = false; setBusy(false); }
  }
  return <section className="mt-3 space-y-2" aria-label={t("customerRating.title")}>
    <div className="flex flex-wrap items-center gap-2"><span className="text-sm crm-text-muted">{t("customerRating.title")}</span>
      <CustomerRatingBadge rating={current.customerRating} unratedLabel={t("followUps.unrated")} title={t("customerRating.title")} />
      {canCorrect && !open && <Button type="button" size="sm" variant="ghost" onClick={() => {
        flight.current = createRatingCorrectionFlight(); setSelection(""); setReason(""); setError(null); setOpen(true);
      }}>{t("customerRating.adjust")}</Button>}
    </div>
    {canCorrect && open && <form onSubmit={submit} className="max-w-lg space-y-3 rounded-xl border p-3">
      <p className="text-sm crm-text-muted">{t("customerRating.correctionNotice")}</p>
      <fieldset disabled={busy} className="min-w-0 space-y-3">
        <div><Label htmlFor="rating-correction">{t("customerRating.choose")}</Label>
          <Select id="rating-correction" value={selection} onChange={e => setSelection(e.target.value)}>
            <option value="">{t("customerRating.choose")}</option>
            {CUSTOMER_RATINGS.map(r => <option key={r} value={r}>{r}</option>)}
            <option value="unrated">{t("customerRating.clear")}</option>
          </Select></div>
        <div><Label htmlFor="rating-reason">{t("customerRating.reason")}</Label>
          <Textarea id="rating-reason" value={reason} rows={3} onChange={e => setReason(e.target.value)} /></div>
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        <div className="flex flex-wrap gap-2"><Button type="submit" disabled={busy}>{t("customerRating.confirm")}</Button>
          <Button type="button" variant="secondary" onClick={() => setOpen(false)}>{t("common.cancel")}</Button></div>
      </fieldset>
    </form>}
  </section>;
}
