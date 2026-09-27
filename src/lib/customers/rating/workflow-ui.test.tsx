import * as React from "react";
import assert from "node:assert/strict";
import { it } from "node:test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { FollowUpRatingFields } from "@/components/follow-ups/follow-up-rating-fields";
import { changeFollowUpField, refreshRatingReference } from "./form-state";
import { RATING_REQUIRED_OUTCOMES, RATING_PRESERVE_OUTCOMES } from "./domain";
import { validateFollowUpInput } from "@/lib/follow-ups/validation";
const formPath = "src/app/(dashboard)/customers/[id]/follow-ups/new/";
const form = readFileSync(formPath + "new-follow-up-form.tsx", "utf8");
const render = (outcome: string, selectedRating = "") => renderToStaticMarkup(<FollowUpRatingFields
  currentRating="A" outcome={outcome} selectedRating={selectedRating} onChange={() => {}} t={key => key} />);
it("all required outcomes render an empty selector and A reference; deliberate A is selectable", () => {
  for (const outcome of RATING_REQUIRED_OUTCOMES) {
    const html = render(outcome);
    assert.match(html, /current-rating-reference.*?A<\/p>/); assert.match(html, /<select/);
    assert.match(html, /<option value="" selected="">/); assert.doesNotMatch(html, /value="A" selected/);
    assert.match(render(outcome, "A"), /<option value="A" selected="">A/);
  }
});
it("all preserve outcomes have no editable selector", () => {
  for (const outcome of RATING_PRESERVE_OUTCOMES) {
    assert.doesNotMatch(render(outcome), /<select/); assert.match(render(outcome), /ratingPreserved/);
  }
});
it("required → preserve → required clears pending choice; stale conflict preserves notes and refreshes only rating", () => {
  const initial = { outcome: "replied", customerRating: "S", summary: "Unsaved summary", nextAction: "Unsaved next action", nextFollowUpAt: "2027-01-01" };
  const preserved = changeFollowUpField(initial, "outcome", "no_reply"); assert.equal(preserved.customerRating, "");
  const required = changeFollowUpField(preserved, "outcome", "replied"); assert.equal(required.customerRating, "");
  const refreshed = refreshRatingReference(initial, "B", 6);
  assert.deepEqual(refreshed.form, { ...initial, customerRating: "" });
  assert.deepEqual(refreshed.reference, { customerRating: "B", customerRatingRevision: 6 });
  const errors = validateFollowUpInput({ ...refreshed.form, channel: "phone", expectedCustomerRatingRevision: 6 });
  assert.ok(errors.some(e => e.code === "CUSTOMER_RATING_REQUIRED"));
});
it("shared form wiring retains F1 lock and stale text, removes legacy input, and passes authorized revision", () => {
  assert.doesNotMatch(form, /customerIntent/); assert.match(form, /customerRating: ""/);
  assert.match(form, /CUSTOMER_RATING_STALE/); assert.match(form, /refreshRatingReference\(form/);
  assert.match(form, /setRatingReference\(refreshed.reference\)/); assert.match(form, /postFollowUpCreateOnce/);
  assert.match(form, /<fieldset disabled=\{submitting\}/);
  assert.match(form, /expectedCustomerRatingRevision: ratingReference.customerRatingRevision/);
  assert.match(readFileSync(formPath + "page.tsx", "utf8"), /customerRatingRevision=\{customer.customerRatingRevision\}/);
});
it("mobile/desktop share fluid native selector without fixed width or alternate data source", () => {
  for (const width of [390, 1280]) {
    const html = renderToStaticMarkup(<div style={{ width }}><FollowUpRatingFields currentRating={null} outcome="replied"
      selectedRating="" onChange={() => {}} t={key => key} /></div>);
    assert.match(html, /w-full/); assert.match(html, /followUps.unrated/); assert.match(html, /id="customerRating"/);
  }
  assert.match(form, /className="max-w-2xl"/); assert.match(form, /className="min-w-0"/);
});
it("correction endpoint retains authenticated boundary without UI or alternate permission path", () => {
  const route = readFileSync("src/app/api/customers/[id]/rating/route.ts", "utf8");
  assert.match(route, /await requireAuth\(request\)/); assert.match(route, /correctCustomerRating\(request,.*user\)/);
});
