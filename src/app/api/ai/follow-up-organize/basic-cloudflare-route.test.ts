import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { resolve } from "node:path";

// Bundle the REAL handlers, service, adapter and permission predicate. Only
// environment/auth/storage/provider seams are local fakes; no D1 or remote AI.
async function fixture(scoped: boolean) {
  const mocks: Record<string,string> = {
    "fixture:state": `export const state={actor:null,customer:{id:'c1',customerName:'Synthetic',ownerId:'owner',status:'active',deletedAt:null},calls:[],output:'客户想开账户。'};`,
    "@/lib/permissions/auth": `import {state} from 'fixture:state'; export async function requireAuth(){state.calls.push('auth');if(!state.actor)throw {status:401};return state.actor;}export function authErrorResponse(e){return Response.json({errorCode:'DENIED'},{status:e.status||500});}`,
    "@/lib/db": `import {state} from 'fixture:state';export const schema={};export function getDb(){state.calls.push('db');return new Proxy({}, {get(){throw new Error('unexpected DB access')}});}`,
    "@/lib/customers/queries": `import {state} from 'fixture:state';export async function getCustomerById(){state.calls.push('customer');return state.customer;}`,
    "@/lib/customers/assignees": `export async function isCustomerAssignee(){return false;}export function isCustomerAssigneeFromRecords(){return false;}`,
    "@/lib/permissions/audit": `export async function logPermissionDenied(){}`,
    "@/lib/customers/pending-on-hold-api": `export async function blockPendingOnHoldCreateCustomer(){return null;}`,
    "@/lib/settings/ai-effective": `export async function getEffectiveAiSettings(){throw new Error('Basic must not use external provider settings');}`,
    "@/lib/ai/providers/factory": `export function allowMockDeepInsightGeneration(){throw new Error('Gemini path reached');}export function resolveCustomerInsightProvider(){throw new Error('Gemini path reached');}`,
    "@opennextjs/cloudflare": `import {state} from 'fixture:state';export function getCloudflareContext(){return {env:{AI_SERVICE:{fetch:async(url,init)=>{state.calls.push(JSON.parse(init.body));return Response.json({ok:true,data:{text:state.output}});}}}};}`,
  };
  const route = scoped ? 'src/app/api/customers/[id]/follow-ups/organize/route.ts' : 'src/app/api/ai/follow-up-organize/route.ts';
  const built = await build({stdin:{contents:`export {POST} from ${JSON.stringify(resolve(route))}; export {state} from 'fixture:state';`,resolveDir:process.cwd(),loader:'ts'},bundle:true,platform:'node',format:'cjs',write:false,packages:'external',plugins:[{name:'local-only',setup(b){b.onResolve({filter:/.*/},args=>args.path in mocks?{path:args.path,namespace:'fixture'}:undefined);b.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:mocks[args.path],loader:'js'}));}}]});
  const bundled={exports:{}};
  new Function('require','module','exports',built.outputFiles[0].text)(createRequire(import.meta.url),bundled,bundled.exports);
  return bundled.exports as {POST:(r:Request,c:{params:Promise<{id:string}>})=>Promise<Response>;state:{actor:null|{id:string;role:string};customer:{status:string;ownerId:string|null};calls:unknown[];output:string}};
}
for (const scoped of [false,true]) describe(scoped?'customer Basic route':'draft Basic route',()=>{
  it('unauthenticated POST performs no AI or business write',async()=>{
    const f=await fixture(scoped);
    const res=await f.POST(new Request('https://local/organize',{method:'POST',body:JSON.stringify({mode:'basic',text:'客户想开账户'})}),{params:Promise.resolve({id:'c1'})});
    assert.equal(res.status,401);assert.deepEqual(f.state.calls,['auth']);
  });
  it('authorized POST sends only selected text and locale; bypasses Gemini/settings/DB mutations',async()=>{
    const f=await fixture(scoped); f.state.actor={id:'owner',role:'staff'};
    const res=await f.POST(new Request('https://local/organize',{method:'POST',body:JSON.stringify({mode:'basic',text:'客户想开账户',locale:'zh-Hans',ignoredProfile:'private context not to send'})}),{params:Promise.resolve({id:'c1'})});
    assert.equal(res.status,200);
    const data=await res.json();assert.equal(data.result.originalText,'客户想开账户');assert.equal(data.result.organizedText,'客户想开账户。');
    const calls=f.state.calls.filter(x=>typeof x==='object');
    assert.deepEqual(calls,[{task:'basic_text_organize',schemaVersion:'basic-fluency-v1',locale:'zh-Hans',text:'客户想开账户'}]);
  });
  it('invalid input/overrides cause no AI request or business mutation',async()=>{
    for(const body of [{mode:'basic',text:'x'},{mode:'basic',text:'x'.repeat(2001)},{mode:'basic',text:'客户想开账户',model:'arbitrary'}]) {
      const f=await fixture(scoped);f.state.actor={id:'owner',role:'staff'};
      const res=await f.POST(new Request('https://local/organize',{method:'POST',body:JSON.stringify(body)}),{params:Promise.resolve({id:'c1'})});
      assert.equal(res.status,400);assert.equal(f.state.calls.filter(x=>typeof x==='object').length,0);
    }
  });
  it('unsafe provider output returns a safe failure and no raw text',async()=>{
    const f=await fixture(scoped);f.state.actor={id:'owner',role:'staff'};f.state.output='客户想开账户，预算5000元。';
    const res=await f.POST(new Request('https://local/organize',{method:'POST',body:JSON.stringify({mode:'basic',text:'客户想开账户'})}),{params:Promise.resolve({id:'c1'})});
    assert.equal(res.status,503);assert.deepEqual(await res.json(),{errorCode:'BASIC_ORGANIZE_UNAVAILABLE'});
  });
});
it('unrelated/archived/public pool customer denies real PATCH-independent organizer before AI',async()=>{
  for(const status of ['active','archived','public_pool']) {
    const f=await fixture(true); f.state.actor={id:'unrelated',role:'staff'};f.state.customer.status=status;
    const res=await f.POST(new Request('https://local/organize',{method:'POST',body:JSON.stringify({mode:'basic',text:'客户想开账户'})}),{params:Promise.resolve({id:'c1'})});
    assert.ok(res.status>=400);assert.equal(f.state.calls.filter(x=>typeof x==='object').length,0);
  }
});
