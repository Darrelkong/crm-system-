import assert from "node:assert/strict";
import { it, mock } from "node:test";
import { handleCrmAiRequest, parseCrmAiRequestBody } from "../src/service";
import { BASIC_ORGANIZE_MODEL } from "../src/basic-organize";
import { BASIC_FLUENCY_VERSION, type BasicFluencyRequest } from "../../../src/lib/ai/follow-up-organize/fluency-contract";
import type { CrmAiEnv } from "../src/types";

function request(text: string, locale: BasicFluencyRequest["locale"] = "zh-Hans"): BasicFluencyRequest {
  return { task: "basic_text_organize", schemaVersion: BASIC_FLUENCY_VERSION, locale, text };
}
const samples = [
  ["客户香港公司 开了几年 想开账户 目前资料不齐说下周整理好 然后联系", "客户的香港公司开了几年，想开账户。目前资料不齐，说下周整理好，然后联系。", "zh-Hans"],
  ["客戶香港公司 想開賬戶 資料不齊下週再聯絡", "客戶的香港公司想開賬戶。資料不齊，下週再聯絡。", "zh-Hant"],
  ["The customer may contact us next week.", "The customer may contact us next week.", "en"],
  ["客户可能于2026-09-27支付HKD 20,000 折扣5%", "客户可能于2026-09-27支付HKD 20,000，折扣5%。", "zh-Hans"],
  ["contact alex@example.test see https://example.test/a?q=1", "contact alex@example.test; see https://example.test/a?q=1", "en"],
] as const;
for (const [input, output, locale] of samples) it(`accepts conservative ${locale} fluency proposal: ${input.slice(0,12)}`, async () => {
  let calls = 0;
  const env: CrmAiEnv = { AI: { run: async (model, payload, options) => {
    calls++; assert.equal(model, BASIC_ORGANIZE_MODEL);
    const messages = payload.messages as Array<{role:string; content:string}>;
    assert.equal(messages.length, 2);
    assert.deepEqual(JSON.parse(messages[1].content), { locale, text: input });
    assert.equal(payload.max_tokens, 2000);
    assert.equal((options?.gateway as {collectLog:boolean}).collectLog, false);
    return { response: JSON.stringify({ text: output }) };
  } } };
  const result = await handleCrmAiRequest(env, request(input, locale));
  assert.deepEqual(result, { ok: true, data: { text: output }, model: BASIC_ORGANIZE_MODEL });
  assert.equal(calls, 1);
});

for (const [input, output] of [
  ["报价HKD 2000 日期2026-09-27", "报价HKD 3000，日期2026-09-27。"],
  ["报价HKD 2000 日期2026-09-27", "报价HKD 2000。"],
  ["客户考虑方案 下一步再联系", "客户考虑方案，下一步再联系，预算10000元。"],
  ["客户可能想开户 下周再联系", "客户想开户，下周再联系。"],
  ["contact alex@example.test next week", "contact bob@example.test next week"],
  ["see https://example.test/path tomorrow", "see https://example.test/other tomorrow"],
  ["客戶說資料尚未準備齊全", "客户说资料尚未准备齐全。"],
  ["Call +852 6123 4567 tomorrow", "Call +852 6123 4568 tomorrow"],
]) it(`rejects fact/script drift without retry: ${input.slice(0,12)}`, async () => {
  let calls=0;
  const result = await handleCrmAiRequest({ AI: { run: async()=> { calls++; return {response:JSON.stringify({text:output})}; } } }, request(input));
  assert.deepEqual(result,{ok:false,error:"invalid_output"}); assert.equal(calls,1);
});

it("rejects malformed, extra fields, truncation and arbitrary envelopes", async()=>{
  for (const raw of ["not json", {response:"broken"}, {response:{text:"客户想开账户。",advice:"x"}}, {unknown:{text:"客户想开账户。"}}, {choices:[{finish_reason:"length",message:{content:'{"text":"客户想开账户。"}'}}]}]) {
    assert.deepEqual(await handleCrmAiRequest({AI:{run:async()=>raw}},request("客户想开账户")),{ok:false,error:"invalid_output"});
  }
});
it("accepts documented completed choices content",async()=>{
  const result=await handleCrmAiRequest({AI:{run:async()=>({choices:[{finish_reason:"stop",message:{content:'{"text":"客户想开账户。"}'}}]})}},request("客户想开账户"));
  assert.equal(result.ok,true);
});
it("returns safe timeout/unavailable categories without logging or retry",async()=>{
  for(const error of [new DOMException("synthetic private text","AbortError"), new Error("503 synthetic private text")]) {
    let calls=0;
    const result=await handleCrmAiRequest({AI:{run:async()=>{calls++;throw error;}}},request("客户想开账户"));
    assert.equal(result.ok,false); assert.equal(calls,1); assert.doesNotMatch(JSON.stringify(result),/private/);
  }
});
it("enforces actual 20-second response deadline with one call",async()=>{
  mock.timers.enable({apis:["setTimeout"]});
  try {
    let calls=0;
    const pending=handleCrmAiRequest({AI:{run:()=>{calls++;return new Promise(()=>{});}}},request("客户想开账户"));
    mock.timers.tick(20_001);
    assert.deepEqual(await pending,{ok:false,error:"timeout"}); assert.equal(calls,1);
  } finally {mock.timers.reset();}
});
it("rejects broad context, model override, invalid locale/length before AI",async()=>{
  const good=request("客户想开账户"); assert.ok(parseCrmAiRequestBody(good));
  for(const bad of [{...good,context:{}},{...good,model:"evil"},{...good,locale:"unknown"},{...good,text:"x".repeat(2001)}]) {
    assert.equal(parseCrmAiRequestBody(bad),null);
  }
});
