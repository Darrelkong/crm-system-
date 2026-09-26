import assert from "node:assert/strict";
import { it, mock } from "node:test";
import Ajv from "ajv";
import { KNOWLEDGE_COMPARE_JSON_SCHEMA, validateCompareOutput } from "../../../workers/crm-ai/src/knowledge";
import { runKnowledgeCompareTask } from "../../../workers/crm-ai/src/service";
import type { CrmAiEnv } from "../../../workers/crm-ai/src/types";
import { KNOWLEDGE_AI_COMPARISON_JSON_SCHEMA, parseKnowledgeAiComparisonOutput } from "./ai-comparison-schema";
import { callKnowledgeCompareCloudflareAi } from "./cloudflare-knowledge-ai";

const validateSchema = new Ajv({ allErrors: true }).compile(KNOWLEDGE_COMPARE_JSON_SCHEMA);
const item = { id: "f1", topic: "Synthetic topic", existingValue: null, incomingValue: "Synthetic fact", explanation: "Synthetic explanation", confidence: 0.8, sourceExcerpt: "Synthetic fact", existingExcerpt: null };
const valid = () => ({ relationship: "update_existing", matchedCandidateKey: "C1", matchConfidence: 0.9,
  newFacts: [{...item}], changedFacts: [{...item}], conflicts: [{...item}], uncertainties: [{...item}],
  suggestedUpdates: [{topic:"Synthetic topic",suggestion:"Review",rationale:"Verify",confidence:0.7}] });
const request = { task: "knowledge_compare" as const, schemaVersion: "knowledge-compare-v1", locale: "en" as const, systemPrompt: "Compare synthetic evidence", userPrompt: "SENSITIVE_SENTINEL_MUST_NOT_BE_LOGGED" };
const env = (run: () => Promise<unknown>): CrmAiEnv => ({ AI: { run } as unknown as Ai });
function assertAll(output: unknown, accepted: boolean) {
  assert.equal(validateSchema(output), accepted, JSON.stringify(validateSchema.errors));
  assert.equal(validateCompareOutput(output) !== null, accepted);
  assert.equal(parseKnowledgeAiComparisonOutput(output).success, accepted);
}
it("one wire schema; representative populated outputs are accepted by all three layers", () => {
  assert.equal(KNOWLEDGE_AI_COMPARISON_JSON_SCHEMA, KNOWLEDGE_COMPARE_JSON_SCHEMA);
  for (const relationship of ["update_existing","new_article","ambiguous"]) {
    for (const key of ["C1","C2","C3",null]) {
      if(relationship==="update_existing" && key===null) continue;
      assertAll({...valid(),relationship,matchedCandidateKey:key},true);
    }
  }
});
for (const key of ["newFacts","changedFacts","conflicts","uncertainties"] as const) {
  for (const field of Object.keys(item)) it(`${key}: missing ${field} rejected by every layer`, () => {
    const output=valid(); Reflect.deleteProperty(output[key][0],field); assertAll(output,false);
  });
}
for (const [name,change] of [
  ["wrong confidence type", (v: ReturnType<typeof valid>) => Reflect.set(v.newFacts[0],"confidence","high")],
  ["negative confidence", (v: ReturnType<typeof valid>) => v.newFacts[0].confidence=-0.1],
  ["confidence above one", (v: ReturnType<typeof valid>) => v.suggestedUpdates[0].confidence=1.1],
  ["top confidence range", (v: ReturnType<typeof valid>) => v.matchConfidence=2],
  ["invalid candidate key", (v: ReturnType<typeof valid>) => v.matchedCandidateKey="C99"],
  ["null update relationship", (v: ReturnType<typeof valid>) => Reflect.set(v,"matchedCandidateKey",null)],
  ["wrong nullable type", (v: ReturnType<typeof valid>) => Reflect.set(v.newFacts[0],"existingValue",42)],
  ["malformed suggested update", (v: ReturnType<typeof valid>) => Reflect.deleteProperty(v.suggestedUpdates[0],"rationale")],
  ["extra diff property", (v: ReturnType<typeof valid>) => Reflect.set(v.newFacts[0],"unknown",true)],
  ["extra update property", (v: ReturnType<typeof valid>) => Reflect.set(v.suggestedUpdates[0],"unknown",true)],
  ["extra top property", (v: ReturnType<typeof valid>) => Reflect.set(v,"unknown",true)],
  ["too many items", (v: ReturnType<typeof valid>) => v.newFacts=Array.from({length:21},()=>({...item}))],
  ["oversized text", (v: ReturnType<typeof valid>) => v.newFacts[0].topic="x".repeat(161)],
] as const) it(`${name} rejected by all layers`, () => {const output=valid();change(output);assertAll(output,false);});

it("actual Worker payload contains the complete schema; invalid output retries once then adapter/Zod accept", async () => {
  const log=mock.method(console,"warn",()=>{}); let calls=0;
  const workerEnv:CrmAiEnv={AI:{run:async (_model: string,payload: {response_format:{json_schema:unknown}})=>{
    assert.deepEqual(payload.response_format.json_schema,KNOWLEDGE_COMPARE_JSON_SCHEMA);
    return {response:++calls===1?{...valid(),newFacts:[{}]}:valid()};
  }} as unknown as Ai};
  try {
    const aiService={fetch:async()=>Response.json(await runKnowledgeCompareTask(workerEnv,request))} as unknown as CloudflareEnv["AI_SERVICE"];
    const result=await callKnowledgeCompareCloudflareAi({...request,aiService});assert.equal(result.ok,true);
    if(!result.ok)throw new Error("expected valid contract");assert.equal(parseKnowledgeAiComparisonOutput(result.data).success,true);assert.equal(calls,2);
    assert.equal(log.mock.calls[0].arguments[1].reason,"invalid_diff_item_shape");assert.equal(log.mock.calls[0].arguments[1].attempt,1);
  } finally {log.mock.restore();}
});
for(const [reason,response] of [
  ["parse_failed","{ SENSITIVE_SENTINEL_MUST_NOT_BE_LOGGED"],
  ["invalid_top_level_shape",{}],
  ["invalid_diff_item_shape",{...valid(),newFacts:[{}]}],
  ["invalid_suggested_update_shape",{...valid(),suggestedUpdates:[{}]}],
  ["invalid_relationship_match",{...valid(),matchedCandidateKey:null}],
] as const) it(`bounded retry and content-free diagnostics: ${reason}`,async()=>{
  const log=mock.method(console,"warn",()=>{});let calls=0;
  try{
    const result=await runKnowledgeCompareTask(env(async()=>{calls++;return{response};}),request);
    assert.deepEqual(result,{ok:false,error:"invalid_output"});assert.equal(calls,2);
    assert.deepEqual(log.mock.calls.map(c=>c.arguments[1].attempt),[1,2]);
    assert.ok(log.mock.calls.every(c=>c.arguments[1].reason===reason));
    const text=JSON.stringify(log.mock.calls.map(c=>c.arguments));assert.ok(!text.includes("SENSITIVE_SENTINEL"));assert.ok(!text.includes("Synthetic fact"));
    for(const call of log.mock.calls)assert.deepEqual(Object.keys(call.arguments[1]).sort(),["arrayCounts","attempt","reason","responseType","task"].sort());
  }finally{log.mock.restore();}
});
