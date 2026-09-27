import assert from "node:assert/strict";
import { it, mock } from "node:test";
import { comparisonFailureDiagnostic, ResponseDeadlineError, runKnowledgeCompareTask } from "../src/service";
import type { CrmAiEnv } from "../src/types";
const request={task:"knowledge_compare" as const,schemaVersion:"knowledge-compare-v1",locale:"en" as const,systemPrompt:"PRIVATE_PROMPT",userPrompt:"PRIVATE_SOURCE"};
for(const [error,source,publicError] of [
  [new ResponseDeadlineError(),"APPLICATION_RESPONSE_DEADLINE","timeout"],
  [new DOMException("PRIVATE_MESSAGE","AbortError"),"PROVIDER_ABORT","timeout"],
  [Object.assign(new Error("PRIVATE_MESSAGE"),{code:3007}),"PROVIDER_TIMEOUT_CODE","timeout"],
  [Object.assign(new Error("PRIVATE_MESSAGE"),{code:3008}),"PROVIDER_TIMEOUT_CODE","timeout"],
  [new Error("provider timeout PRIVATE_MESSAGE"),"PROVIDER_TIMEOUT_MESSAGE","timeout"],
  [new Error("503 unavailable PRIVATE_MESSAGE"),"MODEL_UNAVAILABLE","model_unavailable"],
  [new Error("429 rate limited PRIVATE_MESSAGE"),"RATE_LIMITED","rate_limited"],
  [new Error("PRIVATE_MESSAGE"),"OTHER","internal_error"],
  [new Error("JSON Mode couldn't be met PRIVATE_MESSAGE"),"OTHER","invalid_output"],
] as const)it(`safe diagnosis ${source} preserves public ${publicError}`,async()=>{
  const log=mock.method(console,"warn",()=>{});
  try {
    assert.equal(comparisonFailureDiagnostic(error).timeoutSource,source);
    const env:CrmAiEnv={AI:{run:async()=>{throw error;}} as unknown as Ai};
    assert.deepEqual(await runKnowledgeCompareTask(env,request),{ok:false,error:publicError});
    for(const call of log.mock.calls){
      assert.equal(call.arguments[0],"knowledge_compare_failure");const d=call.arguments[1];
      assert.equal(d.timeoutSource,source);assert.equal(d.providerResultObtained,false);assert.equal(d.configuredDeadlineMs,20000);
      assert.ok(d.elapsedMs>=0);assert.ok([1,2].includes(d.attempt));
      assert.ok(!JSON.stringify(d).includes("PRIVATE_"));
    }
    if(publicError==="timeout")assert.equal(log.mock.calls.length,1);
  } finally {log.mock.restore();}
});
it("real application timer wins before provider result; late settlement creates no duplicate log",async()=>{
  const log=mock.method(console,"warn",()=>{});let settle:(value:unknown)=>void=()=>{};
  try {
    const env:CrmAiEnv={CRM_AI_TIMEOUT_MS:"150",AI:{run:()=>new Promise(resolve=>{settle=resolve;})} as unknown as Ai};
    assert.deepEqual(await runKnowledgeCompareTask(env,request),{ok:false,error:"timeout"});
    const d=log.mock.calls[0].arguments[1];assert.equal(d.timeoutSource,"APPLICATION_RESPONSE_DEADLINE");assert.equal(d.providerResultObtained,false);assert.equal(d.configuredDeadlineMs,150);assert.ok(d.elapsedMs>=140);
    settle({response:"PRIVATE_LATE_RESPONSE"});await Promise.resolve();assert.equal(log.mock.calls.length,1);
  }finally{log.mock.restore();}
});
it("provider output validation failure reports that a result was obtained",async()=>{
  const log=mock.method(console,"warn",()=>{});
  try {
    await runKnowledgeCompareTask({AI:{run:async()=>({response:{}})} as unknown as Ai},request);
    const failures=log.mock.calls.filter(c=>c.arguments[0]==="knowledge_compare_failure");assert.equal(failures.length,2);assert.ok(failures.every(c=>c.arguments[1].providerResultObtained===true));
  }finally{log.mock.restore();}
});
it("arbitrary error names and nonfinite codes cannot leak into diagnostics",()=>{
  const e=Object.assign(new Error("PRIVATE_MESSAGE"),{name:"PRIVATE_NAME",code:Infinity});
  assert.deepEqual(comparisonFailureDiagnostic(e),{timeoutSource:"OTHER",errorClass:"Error"});
});
