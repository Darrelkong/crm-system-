// Real page, GET handler and SQL predicates. In-memory synthetic data only:
// no Cloudflare binding, migrations, auth session, business data or network.
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { drizzle } from 'drizzle-orm/sqlite-proxy';
import { getTableConfig } from 'drizzle-orm/sqlite-core';

export async function relationshipFixture({ pageTransform = source => source } = {}) {
  const mocks = {
    'fixture:state': `export const state={actor:{id:'member',role:'staff'},db:null};`,
    '@/lib/db': `import {state} from 'fixture:state';export * as schema from ${JSON.stringify(resolve('drizzle/schema/index.ts'))};export function getDb(){if(!state.db)throw Error('Local fixture DB missing');return state.db;}`,
    '@/lib/auth/request-cache': `import {state} from 'fixture:state';export async function requireAuthCached(){return state.actor;}`,
    '@/lib/permissions/auth': `import {state} from 'fixture:state';export async function requireAuth(){return state.actor;}export function authErrorResponse(e){throw e;}`,
    '@/lib/customers/create-customer-service': `export class ApprovalError extends Error{};export function prepareCustomerCreation(){throw Error('No writes');}export function executePreparedCustomerCreation(){throw Error('No writes');}`,
    '@/lib/approvals/service': `export function approvalErrorResponse(){throw Error('No writes');}`,
    'next/navigation': `export function redirect(url){throw Error('Unexpected redirect: '+url);}`,
    './customers-list-client': `export function CustomersListClient(){throw Error('Server test must inspect the real page element, not render the client');}`,
    '@/lib/settings/effective': `export async function getEffectiveSettings(){return {};}`,
    '@/lib/reclamation/work-items-sync': `export async function resolveReclamationRiskCustomerIds(){return undefined;}`,
    '@/lib/customers/scoring/service': `export async function getCustomerIdsWithFollowUps(){return new Set();}export function getCustomersWithScores(user,items){return items;}export function parseScoringListFilter(){return {};}`,
    '@/lib/customers/scoring/scoring-list-runtime': `export async function loadScoredCustomerListPage(){throw Error('Scoring not part of this fixture');}`,
    '@/lib/customers/households/list-indicator': `export async function getCustomerIdsWithHouseholdIcon(){return new Set();}`,
    '@/lib/customers/list-rows': `export async function buildCustomerListRows(db,items){return items.map(c=>({...c,ownerName:null,assigneeNames:[],viewerRelationship:c.ownerId==='member'?'owner':'collaborator',heatLevel:'cold',completenessScore:50,neverContacted:true,overdueFollowUp:false,isArchived:c.status==='archived',isMasked:false,isPinned:false,reclamationCountdown:null,hasHouseholdIcon:false}));}`,
  };
  const built = await build({
    stdin: { contents: `export {default as Page} from ${JSON.stringify(resolve('src/app/(dashboard)/customers/page.tsx'))};export {GET} from ${JSON.stringify(resolve('src/app/api/customers/route.ts'))};export {state} from 'fixture:state';export {schema} from '@/lib/db';`, resolveDir: process.cwd(), loader: 'ts' },
    bundle: true, platform: 'node', format: 'cjs', write: false, packages: 'external',
    plugins: [{ name: 'isolated-relationship-fixture', setup(b) {
      b.onLoad({filter:/customers\/page\.tsx$/}, async a => ({contents:pageTransform(await readFile(a.path,'utf8')),loader:'tsx'}));
      b.onResolve({filter:/.*/}, a => a.path in mocks ? {path:a.path,namespace:'fixture'} : undefined);
      b.onLoad({filter:/.*/,namespace:'fixture'}, a => ({contents:mocks[a.path],loader:'js',resolveDir:process.cwd()}));
    }}],
  });
  const bundled = {exports:{}};
  new Function('require','module','exports',built.outputFiles[0].text)(createRequire(import.meta.url),bundled,bundled.exports);
  const {Page, GET, state, schema} = bundled.exports;
  const sqlite = new DatabaseSync(':memory:');
  // Test-only table shapes from current Drizzle columns; no migration runner.
  for (const table of [schema.customers,schema.users,schema.customerAssignees,schema.approvals]) {
    const {name,columns}=getTableConfig(table);
    sqlite.exec(`CREATE TABLE "${name}" (${columns.map(c=>`"${c.name}" ${c.getSQLType()}`).join(',')})`);
  }
  state.db=drizzle(async (sql,params,method)=>{
    if(!/^select\b/i.test(sql))throw Error('Only SELECT permitted after fixture initialization');
    const stmt=sqlite.prepare(sql);stmt.setReturnArrays(true);
    const rows=stmt.all(...params);
    return {rows:method==='get'?rows[0]:rows};
  },{schema});
  sqlite.prepare('INSERT INTO users (id,role,is_active,display_name) VALUES (?,?,1,?)').run('member','staff','Synthetic member');
  sqlite.prepare('INSERT INTO users (id,role,is_active,display_name) VALUES (?,?,1,?)').run('other','staff','Synthetic other');
  const insert=sqlite.prepare(`INSERT INTO customers (id,customer_code,customer_name,name_status,owner_id,status,sales_stage,created_by,created_at,updated_at,is_pinned) VALUES (?,?,?,'confirmed',?,?,'new_lead','other','2026-01-01','2026-01-01',0)`);
  const assign=sqlite.prepare('INSERT INTO customer_assignees (id,customer_id,user_id,role) VALUES (?,?,?,?)');
  for(const [prefix,count,owner] of [['owned',45,'member'],['collab',43,'other'],['private',3,'other']]) {
    for(let i=1;i<=count;i++) {
      const id=`${prefix}-${String(i).padStart(3,'0')}`;
      insert.run(id,id,`Synthetic needle ${id}`,owner,'active');
      if(prefix==='collab')assign.run(id,id,'member','collaborator');
    }
  }
  // Owner wins even if an owner also has a collaborator assignment.
  assign.run('owner-also-collab','owned-001','member','collaborator');
  for(const [id,status] of [['archived','archived'],['pool','public_pool'],['pending','active']]) {
    insert.run(id,id,`Synthetic needle ${id}`,'member',status);
    assign.run(id,id,'member','collaborator');
  }
  sqlite.prepare("INSERT INTO approvals (id,customer_id,request_type,status) VALUES ('pending','pending','create_on_hold_customer','pending')").run();
  return {
    async page(params={},role='staff') {
      state.actor={id:'member',role};
      const element=await Page({searchParams:Promise.resolve(params)});
      return {key:element.key,props:element.props};
    },
    async api(search='',role='staff') {
      state.actor={id:'member',role};
      const response=await GET(new Request(`http://127.0.0.1/api/customers?${search}`));
      if(!response.ok)throw Error(`GET failed ${response.status}`);
      return response.json();
    },
    close(){sqlite.close();},
  };
}
