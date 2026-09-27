import assert from "node:assert/strict";
import { after, before, it } from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import type { TimelineItem, TimelineRating } from "@/lib/customers/timeline/types";
import en from "@/i18n/locales/en";
import hans from "@/i18n/locales/zh-Hans";
import hant from "@/i18n/locales/zh-Hant";
let directory: string;
let render: (items: TimelineItem[], access?: string) => string;
let reference: () => string;
let scores: () => string;
const rating: TimelineRating = { eventId: "event", ratingBefore: "B", ratingAfter: "A", ratingAction: "follow_up_confirmed",
  ratingRecordedAt: "2026-09-27T07:00:00.000Z", ratingReason: null, actorName: "Synthetic human", followUpUnavailable: false };
const followUp: TimelineItem = { id: "follow-up", type: "follow_up", titleKey: "timelineMessages.followUpRecord",
  descriptionText: undefined, descriptionKey: "summary", nextAction: "SAVED NEXT ACTION", actorName: "Synthetic human",
  occurredAt: "2026-08-01T00:00:00.000Z", metadata: {}, sensitive: false, rating };
before(async () => {
  directory = await mkdtemp(join(tmpdir(), "crm-f4e-ui-")); const outfile = join(directory, "render.cjs");
  await build({
    stdin: { contents: `import React from 'react'; import {renderToStaticMarkup} from 'react-dom/server';
      import {CustomerTimelineView} from './src/components/customers/customer-timeline-view';
      import {CustomerAiRatingReference} from './src/components/customers/customer-ai-rating-reference';
      import {CustomerScoresCards} from './src/components/customers/customer-scores-cards';
      import catalog from './src/i18n/locales/zh-Hans';
      const t=(key,params={})=>{let text=key==='summary'?'SAVED SUMMARY':key.split('.').reduce((v,k)=>v?.[k],catalog)??key;
        for(const [k,v] of Object.entries(params)) text=text.replaceAll('{'+k+'}',v);return text;};
      export const render=(items,accessLevel='full')=>renderToStaticMarkup(React.createElement(CustomerTimelineView,{items,accessLevel}));
      export const reference=()=>renderToStaticMarkup(React.createElement(CustomerAiRatingReference,{t,intentLabel:'AI HIGH',intentScore:88,riskFlags:['Synthetic risk <script>']}));
      export const scores=()=>renderToStaticMarkup(React.createElement(CustomerScoresCards,{scores:{heatLevel:'high_churn_risk',heatReasonKeys:[],completenessScore:80,completenessMissingFields:[],accessLevel:'full'},showMissingFields:true}));`,
      resolveDir: process.cwd(), loader: "tsx" }, bundle: true, platform: "node", format: "cjs", outfile,
    plugins: [{ name: "locale", setup(builder) {
      builder.onLoad({ filter: /use-customer-labels\.ts$/ }, () => ({ contents: `import catalog from '${process.cwd()}/src/i18n/locales/zh-Hans';
        export const useCustomerLabels=()=>({t:(key,params={})=>{let text=key==='summary'?'SAVED SUMMARY':key.split('.').reduce((v,k)=>v?.[k],catalog)??key;
        for(const [k,v] of Object.entries(params))text=text.replaceAll('{'+k+'}',v);return text;},
        timelineType:x=>x,followUpChannel:x=>x,followUpOutcome:x=>x,approvalType:x=>x,completenessField:x=>x});`, loader: "js" }));
    } }],
  });
  ({ render, reference, scores } = await import(pathToFileURL(outfile).href));
});
after(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });
it("actual follow-up card renders summary → next action → stored B→A with submission clock", () => {
  const html = render([followUp]);
  assert.ok(html.indexOf('SAVED SUMMARY') < html.indexOf('SAVED NEXT ACTION'));
  assert.ok(html.indexOf('SAVED NEXT ACTION') < html.indexOf('B → A'));
  assert.match(html, /评级确认时间：2026-09-27 15:00/); assert.match(html, /2026-08-01/);
});
it("UNRATED→S and A→A explicitly show human confirmation, not current customer rating", () => {
  assert.match(render([{ ...followUp, rating: { ...rating, ratingBefore: null, ratingAfter: "S" } }]), /未评级 → S/);
  assert.match(render([{ ...followUp, rating: { ...rating, ratingBefore: "A" } }]), /A（人工确认保持）/);
});
it("manual correction/clear and deleted follow-up render reason, actor and honest unavailable label", () => {
  const manual: TimelineItem = { ...followUp, type: "rating", titleKey: "customerRating.historyClear", occurredAt: rating.ratingRecordedAt,
    rating: { ...rating, ratingAction: "manual_clear", ratingBefore: "A", ratingAfter: null, ratingReason: "Human <script>reason" } };
  const html = render([manual]); assert.match(html, /客户评级清除/); assert.match(html, /A → 未评级/);
  assert.match(html, /Human &lt;script&gt;reason/); assert.match(html, /Synthetic human/);
  assert.match(render([{ ...manual, rating: { ...rating, followUpUnavailable: true } }]), /原关联跟进记录已不可用/);
});
it("historical/preserve cards have no fake rating; non-full renderer never exposes an accidental rating snapshot", () => {
  assert.doesNotMatch(render([{ ...followUp, rating: undefined }]), /timeline-rating|评级确认时间/);
  for (const access of ["masked", "archived_basic"]) {
    assert.doesNotMatch(render([followUp], access), /timeline-rating|B → A|评级确认时间/);
    assert.doesNotMatch(render([{ ...followUp, type: "rating", titleKey: "customerRating.historyCorrection" }], access), /客户评级人工调整|timeline-rating|Synthetic human/);
  }
});
it("AI intent/score/risk are inside closed neutral AI Reference, with no rating automation claim", () => {
  const html = reference(); assert.match(html, /AI分析不会修改人工S\/A\/B\/D客户评级/);
  assert.match(html, /<details[^>]*>/); assert.doesNotMatch(html, /<details[^>]*\bopen|text-(red|orange|amber)|text-2xl/);
  assert.ok(html.indexOf('<details') < html.indexOf('AI HIGH')); assert.ok(html.indexOf('88') < html.indexOf('</details>'));
  assert.match(html, /Synthetic risk &lt;script&gt;/);
});
it("detail scores render completeness only, without Heat or a vacant two-column layout", () => {
  const html = scores(); assert.match(html, /80/); assert.doesNotMatch(html, /客户热度|需优先跟进|sm:grid-cols-2/);
});
it("daily list/detail retain human rating and factual reclaim indicators; old heat URL remains compatible", async () => {
  const list = await readFile('src/app/(dashboard)/customers/customers-list-client.tsx','utf8');
  const detail = await readFile('src/app/(dashboard)/customers/[id]/customer-detail-client.tsx','utf8');
  assert.match(list, /CustomerRatingBadge/); assert.doesNotMatch(list, /HeatBadge/); assert.match(list, /ReclamationCountdownBadge/);
  assert.match(list, /name="heat" value=\{heatFilter\}/); assert.match(detail, /CustomerRatingPanel/);
  for (const role of ['admin','staff']) assert.match(await readFile(`src/components/dashboard/${role}-dashboard-client.tsx`,'utf8'), /heat=high_churn_risk/);
  const ai = await readFile('src/components/customers/customer-ai-insight-panel.tsx','utf8');
  assert.match(ai, /CustomerAiRatingReference/); assert.match(ai, /systemReferenceNotice/); assert.doesNotMatch(ai, /INTENT_BADGE_CLASS/);
  for (const source of [list,detail,ai,await readFile('src/lib/customers/scoring/heat.ts','utf8')]) assert.doesNotMatch(source, /customer_rating\s*=|customerRating\s*:\s*["'][SABD]["']/);
});
it("all locales use factual churn labels and explicit AI/system separation", () => {
  for (const locale of [en,hans,hant]) {
    assert.match(locale.customerRating.aiReferenceNotice, /S\/A\/B\/D/);
    assert.ok(locale.customerRating.systemReferenceNotice.length > 8);
    assert.doesNotMatch(locale.heatLevels.high_churn_risk, /流失|churn/i);
    assert.doesNotMatch(locale.dashboard.highChurnRiskClients, /流失|churn/i);
  }
});
