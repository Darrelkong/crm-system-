import assert from "node:assert/strict";
import { it, mock } from "node:test";
import { KNOWLEDGE_MODEL, KNOWLEDGE_COMPARE_GLM_MODEL, KNOWLEDGE_COMPARE_DEEPSEEK_MODEL, KNOWLEDGE_VISION_MODEL, resolveKnowledgeCompareModel } from "../src/models";
import { extractComparisonPayload, KNOWLEDGE_COMPARE_JSON_SCHEMA } from "../src/knowledge";
import { handleCrmAiRequest, runKnowledgeCompareTask } from "../src/service";
import type { CrmAiEnv, CrmAiRequest } from "../src/types";
const output={relationship:"new_article",matchedCandidateKey:null,matchConfidence:0.8,newFacts:[],changedFacts:[],conflicts:[],uncertainties:[],suggestedUpdates:[]};
const request={task:"knowledge_compare" as const,schemaVersion:"knowledge-compare-v1",locale:"en" as const,systemPrompt:"Synthetic system",userPrompt:"Synthetic user"};
for(const override of [undefined,"",KNOWLEDGE_MODEL,"arbitrary-model",KNOWLEDGE_COMPARE_GLM_MODEL,KNOWLEDGE_COMPARE_DEEPSEEK_MODEL]) {
  it(`comparison resolver and invocation: ${override ?? "default"}`,async()=>{
    const expected=override===KNOWLEDGE_COMPARE_GLM_MODEL||override===KNOWLEDGE_COMPARE_DEEPSEEK_MODEL?override:KNOWLEDGE_MODEL;
    assert.equal(resolveKnowledgeCompareModel(override),expected);
    const env:CrmAiEnv={CRM_AI_KNOWLEDGE_COMPARE_MODEL:override,AI:{run:async(model:string,payload:Record<string,unknown>)=>{
      assert.equal(model,expected);assert.equal(payload.max_tokens,3072);assert.equal(payload.temperature,0.2);
      assert.deepEqual(payload.messages,[{role:"system",content:request.systemPrompt},{role:"user",content:request.userPrompt}]);
      assert.deepEqual(payload.response_format,{type:"json_schema",json_schema:expected===KNOWLEDGE_COMPARE_GLM_MODEL?{name:"knowledge_compare",strict:true,schema:KNOWLEDGE_COMPARE_JSON_SCHEMA}:KNOWLEDGE_COMPARE_JSON_SCHEMA});
      assert.deepEqual(payload.chat_template_kwargs,expected===KNOWLEDGE_COMPARE_GLM_MODEL?{enable_thinking:false}:undefined);
      return expected===KNOWLEDGE_COMPARE_GLM_MODEL?{choices:[{message:{content:JSON.stringify(output),reasoning_content:"must not be parsed"}}]}:{response:output};
    }} as unknown as Ai};
    const result=await runKnowledgeCompareTask(env,request);assert.equal(result.ok,true);if(result.ok)assert.equal(result.model,expected);
  });
}
it("GLM strict validation and bounded retry are unchanged",async()=>{
  const log=mock.method(console,"warn",()=>{});let calls=0;
  try {
    const env:CrmAiEnv={CRM_AI_KNOWLEDGE_COMPARE_MODEL:KNOWLEDGE_COMPARE_GLM_MODEL,AI:{run:async()=>{
      calls++;return {choices:[{message:{content:JSON.stringify({...output,extra:true})}}]};
    }} as unknown as Ai};
    assert.deepEqual(await runKnowledgeCompareTask(env,request),{ok:false,error:"invalid_output"});assert.equal(calls,2);
  }finally{log.mock.restore();}
});
it("normalization recognizes only documented content; does not unwrap arbitrary keys or reasoning",()=>{
  assert.equal(extractComparisonPayload({choices:[{message:{content:"{}"}}]},KNOWLEDGE_COMPARE_GLM_MODEL),"{}");
  for(const raw of [{choices:[]},{choices:[{},{}]},{choices:[{message:{reasoning_content:"{}"}}]},{choices:[{message:{content:{}}}]}])assert.equal(extractComparisonPayload(raw,KNOWLEDGE_COMPARE_GLM_MODEL),null);
  const unknown={arbitrary:{content:JSON.stringify(output)}};assert.equal(extractComparisonPayload(unknown,KNOWLEDGE_COMPARE_GLM_MODEL),unknown);
  const qwen={response:output,choices:[{message:{content:"ignored"}}]};assert.equal(extractComparisonPayload(qwen,KNOWLEDGE_MODEL),output);
});
for(const [task,schemaVersion,result] of [
  ["knowledge_category_suggest","knowledge-category-suggest-v1",{categoryId:null,confidenceBand:"low"}],
  ["knowledge_organize","knowledge-organize-v1",{title:"Synthetic",summary:null,body:"Evidence",suggestedCategory:null,warnings:[]}],
  ["knowledge_qa","knowledge-qa-v1",{answer:"Synthetic",citationIds:[],insufficientInformation:true}],
] as const)it(`comparison override does not change ${task}`,async()=>{
  const env:CrmAiEnv={CRM_AI_KNOWLEDGE_COMPARE_MODEL:KNOWLEDGE_COMPARE_DEEPSEEK_MODEL,AI:{run:async(model:string,payload:Record<string,unknown>)=>{
    assert.equal(model,KNOWLEDGE_MODEL);assert.equal(payload.chat_template_kwargs,undefined);return {response:result};
  }} as unknown as Ai};
  assert.equal((await handleCrmAiRequest(env,{...request,task,schemaVersion} as CrmAiRequest)).ok,true);
});
it("Vision model constant remains unchanged",()=>assert.equal(KNOWLEDGE_VISION_MODEL,"@cf/google/gemma-4-26b-a4b-it"));
it("comparison override does not change Vision invocation",async()=>{
  const env:CrmAiEnv={CRM_AI_KNOWLEDGE_COMPARE_MODEL:KNOWLEDGE_COMPARE_DEEPSEEK_MODEL,AI:{run:async(model:string)=>{
    assert.equal(model,KNOWLEDGE_VISION_MODEL);return {response:"Synthetic transcription"};
  }} as unknown as Ai};
  const result=await handleCrmAiRequest(env,{task:"knowledge_vision_extract",schemaVersion:"knowledge-vision-extract-v1",locale:"en",mimeType:"image/png",imageBase64:"aGVsbG8=",byteSize:5});
  assert.equal(result.ok,true);
});
