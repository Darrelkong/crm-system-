import * as React from "react";
import assert from "node:assert/strict";
import { it } from "node:test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { CustomerRatingBadge } from "@/components/customers/customer-rating-badge";
import { createRatingCorrectionFlight, newerRatingReference, readRatingReference, validCorrectionSelection } from "./correction-client";
import en from "@/i18n/locales/en";
import hans from "@/i18n/locales/zh-Hans";
import hant from "@/i18n/locales/zh-Hant";
it("S/A/B/D and neutral unrated use one compact accessible badge, separate from countdown", () => {
  for (const rating of ["S", "A", "B", "D", null] as const) {
    const html = renderToStaticMarkup(<CustomerRatingBadge rating={rating} unratedLabel="Unrated" title="Customer rating" />);
    assert.ok(html.includes(`>${rating ?? "Unrated"}</span>`)); assert.match(html, /text-xs/);
    if (rating === null) { assert.match(html, /text-slate-500/); assert.doesNotMatch(html, /text-red|text-orange/); }
    assert.doesNotMatch(html, /reclaim|countdown|距回收/i);
  }
});
it("short reason/empty choice rejected, explicit same rating and clear valid", () => {
  assert.equal(validCorrectionSelection("", "Valid reason"), false);
  assert.equal(validCorrectionSelection("C", "Valid reason"), false);
  assert.equal(validCorrectionSelection("A", " 1234 "), false);
  assert.equal(validCorrectionSelection("A", "12345"), true);
  assert.equal(validCorrectionSelection("unrated", "12345"), true);
});
it("10 simultaneous correction saves make one POST with stable identity; response-loss retry recovers same identity", async () => {
  const flight = createRatingCorrectionFlight(), sent: Array<Record<string, unknown>> = [];
  let release = () => {};
  const wait = new Promise<void>(r => { release = r; });
  const transport: typeof fetch = async (_url, init) => { sent.push(JSON.parse(init!.body as string)); await wait; throw new Error("response loss"); };
  const input = { rating: "A" as const, expectedRevision: 2, reason: "Human reason" };
  const requests = Array.from({ length: 10 }, () => flight.submit("customer", input, transport));
  assert.equal(sent.length, 1); release();
  const results = await Promise.allSettled(requests); assert.equal(results.filter(r => r.status === "rejected").length, 1);
  const response = await flight.submit("customer", input, async (_url, init) => {
    sent.push(JSON.parse(init!.body as string)); return Response.json({ customerRating: "A", customerRatingRevision: 3 });
  });
  assert.equal(sent[0].submissionId, sent[1].submissionId);
  assert.deepEqual(readRatingReference(await response!.json()), { customerRating: "A", customerRatingRevision: 3 });
});
it("stale response does not auto-retry; explicit new revision gets new logical identity", async () => {
  const flight = createRatingCorrectionFlight(), sent: Array<Record<string, unknown>> = [];
  const input = { rating: "B" as const, expectedRevision: 1, reason: "Retain this reason" };
  const response = await flight.submit("c", input, async (_url, init) => {
    sent.push(JSON.parse(init!.body as string)); return Response.json({ errorCode: "CUSTOMER_RATING_STALE", customerRating: "S", customerRatingRevision: 4 }, { status: 409 });
  });
  assert.equal(response!.status, 409); const next = readRatingReference(await response!.json())!;
  assert.equal(sent.length, 1); assert.equal(input.reason, "Retain this reason"); assert.equal(input.rating, "B");
  await flight.submit("c", { ...input, expectedRevision: next.customerRatingRevision }, async (_url, init) => {
    sent.push(JSON.parse(init!.body as string)); return Response.json({ ok: true });
  });
  assert.notEqual(sent[0].submissionId, sent[1].submissionId);
  assert.equal(sent[1].expectedRevision, 4);
});
it("canonical older receipt cannot regress local authoritative rating", () => {
  const current = { customerRating: "S" as const, customerRatingRevision: 7 };
  assert.deepEqual(newerRatingReference(current, { customerRating: "A", customerRatingRevision: 3 }), current);
  assert.equal(readRatingReference({ customerRating: "C", customerRatingRevision: 4 }), null);
});
it("correction controls are gated server/client; reason/selection retained on stale; no follow-up endpoint", () => {
  const panel = readFileSync("src/components/customers/customer-rating-panel.tsx", "utf8");
  const page = readFileSync("src/app/(dashboard)/customers/[id]/page.tsx", "utf8");
  const detail = readFileSync("src/app/(dashboard)/customers/[id]/customer-detail-client.tsx", "utf8");
  assert.match(panel, /option value="unrated"/); assert.match(panel, /validCorrectionSelection/);
  assert.match(panel, /canCorrect && !open/); assert.match(panel, /active.current = true/);
  const stale = panel.slice(panel.indexOf('response.status === 409'), panel.indexOf('} else { setError'));
  assert.match(stale, /setReference/); assert.doesNotMatch(stale, /setSelection|setReason|\.submit\(/);
  assert.match(page, /canCorrectRating: view.accessLevel === "full" && showFollowUpButton && customer.status !== "public_pool" && !customer.deletedAt/);
  assert.match(detail, /view.accessLevel === "full" && !view.isMasked/);
  assert.match(detail, /view.status !== "public_pool" && !view.isArchived/);
  assert.doesNotMatch(panel, /\/follow-ups|lastValidFollowUpAt|reclamationCycleStartedAt/);
  for (const catalog of [en, hans, hant]) assert.ok(catalog.customerRating.correctionNotice.length > 20);
  assert.match(en.customerRating.correctionNotice, /not a follow-up.*will not reset/);
});
it("all daily card variants use rating badge independently of countdown; staff Pool has no badge", () => {
  const list = readFileSync("src/app/(dashboard)/customers/customers-list-client.tsx", "utf8");
  assert.equal((list.match(/<CustomerRatingBadge /g) ?? []).length, 2);
  assert.match(list, /!c.isMasked && c.customerRating !== undefined/); assert.match(list, /ReclamationCountdownBadge/);
  const pool = readFileSync("src/app/(dashboard)/public-pool/public-pool-client.tsx", "utf8");
  assert.match(pool, /if \(previousItems !== initialItems\)/);
  assert.match(pool, /adminView && isAdminPublicPoolCustomerView\(c\) && <CustomerRatingBadge/);
  const query = readFileSync("src/lib/public-pool/queries.ts", "utf8");
  const random = query.slice(query.indexOf("const publicPoolCandidateOrderBy"), query.indexOf("async function loadPublicPoolListCustomerData"));
  assert.doesNotMatch(random, /customerRating|customer_rating|RatingOrder/);
});
