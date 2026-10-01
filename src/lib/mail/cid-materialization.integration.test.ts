import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { eq } from "drizzle-orm";
import { bindTestDatabase } from "@/lib/db";
import * as schema from "../../../drizzle/schema";
import { createCidLocalD1, seedCidLegacyRows, CID_TEST_OWNER } from "./test-fixtures/cid-local-d1";
import { MemoryInboundRawPayloadStore } from "./inbound-raw-payload-store";
import { MemoryInboundAttachmentStore } from "./inbound-attachment-store";
import { materializeInboundIngestionEvent } from "./inbound-message-materialization-service";
import { stageInboundProviderEvent } from "./inbound-provider-staging-service";
import { cidMime, cidPng, type CidPart } from "../../../scripts/mail-reader-geometry/cid-fixtures";
import { handleGetMailInlineResource } from "@/app/api/mail/messages/[id]/inline-resources/[attachmentId]/route";
import { makeRequireMailActor } from "@/app/api/mail/mail-read-route-test-helpers";
import { MemoryMailAttachmentByteReader } from "./mail-attachment-byte-reader";
import { getMessageDetail } from "./mail-read-service";
import type { MailActorContext } from "./actor-context";

const env=createCidLocalD1();
let connection:Awaited<ReturnType<typeof env.open>>;
const rawStore=new MemoryInboundRawPayloadStore(), store=new MemoryInboundAttachmentStore();
const actor:MailActorContext={userId:CID_TEST_OWNER,crmRole:"staff",sessionId:null,mailAccessEnabled:true,adminGrants:[],audit:{ipAddress:"127.0.0.1",userAgent:"cid-local-test"}};
let seq=0;
before(async()=>{env.apply(92);connection=await env.open();process.env.CRM_ALLOW_TEST_DB_BIND="1";bindTestDatabase(connection.db);await seedCidLegacyRows(connection.raw);});
after(async()=>{await connection?.dispose();});
async function stage(name:string,parts:CidPart[],html='<img src="cid:Logo@Example">',messageId=name){const mime=cidMime({name,parts,html,messageId});const staged=await stageInboundProviderEvent(connection.db,rawStore,{provider:"cid-local",providerEventId:`event-${++seq}`,receivedAt:"2026-10-02T00:00:00.000Z",rawPayloadBytes:mime,envelopeRecipients:["cid-test@example.invalid"]});return staged.envelopeResults[0].ingestionEventId;}
async function materialize(id:string){return materializeInboundIngestionEvent(connection.db,{rawPayloadStore:rawStore,attachmentStore:store},{ingestionEventId:id});}
async function create(name:string,parts:CidPart[],html?:string){const id=await stage(name,parts,html);return {id,...await materialize(id)};}
async function rows(messageId:string){return connection.db.select().from(schema.mailMessageAttachments).where(eq(schema.mailMessageAttachments.messageId,messageId)).orderBy(schema.mailMessageAttachments.sortOrder);}
const logo={cid:"<Logo@Example>",disposition:"inline" as const};
async function request(messageId:string,attachmentId:string,who=actor,folder="inbox",missing=false){
 const objects=new Map<string,Uint8Array>();if(!missing){for(const file of await connection.db.select().from(schema.mailStoredFiles)){const bytes=file.storageKey.startsWith("mail/inbound-attachments/")?store.getObject(file.storageKey):undefined;if(bytes)objects.set(file.storageKey,bytes);}}
 return handleGetMailInlineResource(new Request(`http://127.0.0.1/api/mail/messages/${messageId}/inline-resources/${attachmentId}?folder=${folder}`),messageId,attachmentId,{requireMailActor:makeRequireMailActor(connection.db,who),createByteReader:()=>new MemoryMailAttachmentByteReader(objects)});
}
test("parser→materializer persists case/percent/disposition/order; same-ingestion and RFC replay canonical",async()=>{
 const parts=[logo,{cid:"<a+%40@Example>"},{cid:"<other@example>",disposition:"attachment" as const}];const made=await create("replay",parts);const first=await rows(made.message.id);
 assert.deepEqual(first.map(r=>[r.contentIdNormalized,r.contentDisposition,r.sortOrder]),[["Logo@Example","inline",0],["a+%40@Example","attachment",1],["other@example","attachment",2]]);
 assert.equal((await materialize(made.id)).message.id,made.message.id);
 const converged=await materialize(await stage("replay",parts));assert.equal(converged.message.id,made.message.id);assert.equal(converged.convergedExistingMessage,true);assert.deepEqual(await rows(made.message.id),first);
 const detail=await getMessageDetail(connection.db,actor,made.message.id,{folder:"inbox"});assert.deepEqual(detail.inlineResources,[{cid:"Logo@Example",attachmentId:first[0].id}]);assert.doesNotMatch(JSON.stringify(detail),/storageKey|storage_key|a\+%40@Example/);
 assert.equal((await request(made.message.id,first[0].id)).status,200);
});
for(const change of ["cid","disposition"])test(`RFC convergence refuses ${change} disagreement without overwriting canonical graph`,async()=>{
 const made=await create(`conflict-${change}`,[logo]);const first=await rows(made.message.id);
 const altered=change==="cid"?{...logo,cid:"<other@example>"}:{...logo,disposition:"attachment" as const};
 await assert.rejects(materialize(await stage(`conflict-${change}`,[altered])),/canonical semantics|integrity/i);
 assert.deepEqual(await rows(made.message.id),first);assert.equal((await connection.db.select().from(schema.mailMessages).where(eq(schema.mailMessages.internetMessageId,`<conflict-${change}@cid-test.invalid>`))).length,1);
});
test("duplicate CID rows survive; ambiguity counted before MIME or disposition",async()=>{
 const made=await create("duplicate",[logo,{...logo,disposition:"attachment",mime:"application/pdf",bytes:new TextEncoder().encode("%PDF-safe")}]);const attached=await rows(made.message.id);assert.equal(attached.length,2);
 assert.deepEqual((await getMessageDetail(connection.db,actor,made.message.id,{folder:"inbox"})).inlineResources,[{cid:"Logo@Example",attachmentId:null}]);assert.equal((await request(made.message.id,attached[0].id)).status,404);
});
test("graph batch failure rolls back body, attachments, message and materialization",async()=>{
 const id=await stage("rollback",[logo]);await connection.raw.prepare("CREATE TRIGGER cid_test_fail BEFORE INSERT ON mail_message_attachments WHEN NEW.content_id_normalized='Logo@Example' BEGIN SELECT RAISE(ABORT, 'cid_test_forced_failure'); END").run();
 try{await assert.rejects(materialize(id));assert.equal((await connection.db.select().from(schema.mailMessages).where(eq(schema.mailMessages.internetMessageId,"<rollback@cid-test.invalid>"))).length,0);const orphan=await connection.raw.prepare("SELECT b.message_id FROM mail_message_bodies b LEFT JOIN mail_messages m ON m.id=b.message_id WHERE m.id IS NULL").all();assert.equal(orphan.results.length,0);}finally{await connection.raw.prepare("DROP TRIGGER cid_test_fail").run();}
 assert.equal((await materialize(id)).message.internetMessageId,"<rollback@cid-test.invalid>");
});
test("authorized PNG bytes are private/no-store/nosniff and match original; missing object fails closed",async()=>{
 const made=await create("bytes",[logo]);const [a]=await rows(made.message.id);const response=await request(made.message.id,a.id);assert.equal(response.status,200);assert.equal(response.headers.get("Content-Type"),"image/png");assert.equal(response.headers.get("Cache-Control"),"private, no-store");assert.equal(response.headers.get("X-Content-Type-Options"),"nosniff");assert.deepEqual(Buffer.from(await response.arrayBuffer()),cidPng());assert.equal((await request(made.message.id,a.id,actor,"inbox",true)).status,404);
});
test("message scope and folder/actor/mailbox gates deny guessed resources and cross-message access",async()=>{
 const made=await create("auth",[logo]);const other=await create("auth-other",[logo]);const [a]=await rows(made.message.id);const [b]=await rows(other.message.id);
 for(const id of [b.id,a.storedFileId,"guessed","Logo@Example"])assert.equal((await request(made.message.id,id)).status,404);
 assert.equal((await request(made.message.id,a.id,{...actor,userId:"cid-test-other"})).status,404);
 assert.equal((await request(made.message.id,a.id,{...actor,mailAccessEnabled:false})).status,403);
 for(const folder of ["sent","trash"])assert.equal((await request(made.message.id,a.id,actor,folder)).status,404);
 await connection.db.update(schema.mailMessages).set({trashedAt:"2026-10-02"}).where(eq(schema.mailMessages.id,made.message.id));assert.equal((await request(made.message.id,a.id)).status,404);assert.equal((await request(made.message.id,a.id,actor,"trash")).status,200);
 await connection.db.update(schema.mailMailboxes).set({status:"suspended"}).where(eq(schema.mailMailboxes.id,"cid-test-box"));try{assert.equal((await request(other.message.id,b.id)).status,404);}finally{await connection.db.update(schema.mailMailboxes).set({status:"active"}).where(eq(schema.mailMailboxes.id,"cid-test-box"));}
});
test("missing and wrong-case CID remain unavailable; no historical fabrication",async()=>{
 const made=await create("missing",[logo],'<img src="cid:missing@example"><img src="cid:logo@Example">');assert.deepEqual((await getMessageDetail(connection.db,actor,made.message.id,{folder:"inbox"})).inlineResources,[{cid:"missing@example",attachmentId:null},{cid:"logo@Example",attachmentId:null}]);
 const [old]=await rows("cid-old-message");assert.equal(old.contentIdNormalized,null);assert.equal(old.contentDisposition,null);assert.equal((await request("cid-old-message",old.id)).status,404);
});
test("absent or malformed Content-ID persists NULL without changing attachment order", async () => {
 const made = await create("invalid-header", [{}, {cid:"<bad id@example>", disposition:"inline"}]);
 assert.deepEqual((await rows(made.message.id)).map(row => [row.contentIdNormalized, row.contentDisposition, row.sortOrder]), [[null,"attachment",0],[null,"inline",1]]);
});
test("owning another mailbox does not authorize this message's inline resource", async () => {
 await connection.db.insert(schema.mailMailboxes).values({id:"cid-other-box",address:"other-box@example.invalid",mailboxType:"personal",createdBy:"cid-test-other",createdAt:"2026-10-02",updatedAt:"2026-10-02"});
 const made = await create("wrong-mailbox", [logo]);
 assert.equal((await request(made.message.id, (await rows(made.message.id))[0].id, {...actor,userId:"cid-test-other"})).status,404);
});
for(const status of ["blocked","scan_failed"] as const)test(`${status} bytes denied`,async()=>{const made=await create(status,[logo]);const [a]=await rows(made.message.id);await connection.db.update(schema.mailStoredFiles).set({securityScanStatus:status,securityScannedAt:"2026-10-02"}).where(eq(schema.mailStoredFiles.id,a.storedFileId));assert.equal((await request(made.message.id,a.id)).status,404);});
for(const kind of ["bad-bytes","mislabeled","pdf","svg","html"])test(`inline rejects ${kind}`,async()=>{
 const made=await create(`reject-${kind}`,[logo]);const [a]=await rows(made.message.id);
 // Post-persistence corruption fixture: no unsafe MIME need pass the inbound attachment gate.
 const mime=({mislabeled:"image/jpeg",pdf:"application/pdf",svg:"image/svg+xml",html:"text/html"} as Record<string,string>)[kind]??"image/png";
 await connection.db.update(schema.mailStoredFiles).set({mimeType:mime}).where(eq(schema.mailStoredFiles.id,a.storedFileId));await connection.db.update(schema.mailMessageAttachments).set({mimeType:mime}).where(eq(schema.mailMessageAttachments.id,a.id));
 if(kind==="bad-bytes") {const [file]=await connection.db.select().from(schema.mailStoredFiles).where(eq(schema.mailStoredFiles.id,a.storedFileId));const response=await handleGetMailInlineResource(new Request("http://127.0.0.1/?folder=inbox"),made.message.id,a.id,{requireMailActor:makeRequireMailActor(connection.db,actor),createByteReader:()=>new MemoryMailAttachmentByteReader(new Map([[file.storageKey,new Uint8Array(a.sizeBytes)]]))});assert.equal(response.status,415);}else assert.equal((await request(made.message.id,a.id)).status,kind==="mislabeled"?415:404);
});
test("Bcc recipient visibility remains under existing message role policy",async()=>{
 const made=await create("bcc",[logo]);await connection.db.insert(schema.mailMailboxMembers).values({id:"cid-other-member",mailboxId:"cid-test-box",userId:"cid-test-other",canRead:1,grantedBy:CID_TEST_OWNER,createdAt:"2026-10-02",updatedAt:"2026-10-02"});
 const detail=await getMessageDetail(connection.db,{...actor,userId:"cid-test-other"},made.message.id,{folder:"inbox"});assert.equal(detail.recipients.some(r=>r.recipientType==="bcc"),false);assert.equal((await request(made.message.id,(await rows(made.message.id))[0].id,{...actor,userId:"cid-test-other"})).status,200);
});
test("final D1 integrity",async()=>{assert.deepEqual((await connection.raw.prepare("PRAGMA foreign_key_check").all()).results,[]);assert.equal((await connection.raw.prepare("PRAGMA quick_check").first())?.quick_check,"ok");});
