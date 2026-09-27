import assert from "node:assert/strict";
import { it, mock } from "node:test";
import { organizeBasicWithCloudflare, BasicOrganizeError } from "./cloudflare-basic";

it("adapter fails closed for unavailable, malformed or fact-changing responses",async()=>{
  const original="客户可能支付HKD 2000";
  for(const response of [new Response('unavailable',{status:503}),new Response('not json'),Response.json({ok:true,data:{text:'客户支付HKD 2000'}}),Response.json({ok:true,data:{text:'客户可能支付HKD 3000'}})]) {
    let calls=0;
    await assert.rejects(()=>organizeBasicWithCloudflare(original,'zh-Hans','synthetic',{fetch:async()=>{calls++;return response;}}),BasicOrganizeError);
    assert.equal(calls,1);assert.equal(original,'客户可能支付HKD 2000');
  }
});
it("adapter has a bounded wait and never retries response loss",async()=>{
  mock.timers.enable({apis:['setTimeout']});
  try {
    let calls=0;
    const pending=organizeBasicWithCloudflare('客户想开账户','zh-Hans','synthetic',{fetch:()=>{calls++;return new Promise(()=>{});}});
    const assertion=assert.rejects(()=>pending,BasicOrganizeError);
    mock.timers.tick(23_001);await assertion;assert.equal(calls,1);
  } finally {mock.timers.reset();}
});
