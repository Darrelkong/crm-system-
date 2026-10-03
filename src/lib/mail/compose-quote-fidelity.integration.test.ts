import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { eq } from "drizzle-orm";
import * as schema from "../../../drizzle/schema";
import { bindTestDatabase } from "@/lib/db";
import { createCidLocalD1, seedCidLegacyRows, CID_TEST_OWNER, CID_TEST_NOW } from "./test-fixtures/cid-local-d1";
import { MemoryInboundRawPayloadStore } from "./inbound-raw-payload-store";
import { MemoryInboundAttachmentStore } from "./inbound-attachment-store";
import { stageInboundProviderEvent } from "./inbound-provider-staging-service";
import { materializeInboundIngestionEvent } from "./inbound-message-materialization-service";
import { cidMime } from "../../../scripts/mail-reader-geometry/cid-fixtures";
import { createSeededComposeDraft } from "./compose-draft-seed-service";
import { updateDraft, getDraft } from "./draft-service";
import { createOutboundRevisionFromDraft, recomputeOutboundRevisionContentHash } from "./outbound-revision-service";
import { buildDraftUpdatePayload, draftDetailToComposeState } from "./client/draft-management";
import { readLimitedJsonBody } from "@/lib/http/read-limited-json-body";
import { MAIL_API_MAX_JSON_BYTES } from "./constants";
import { buildCloudflareEmailOutboundSendRequest } from "./cloudflare-email-outbound-transport-adapter";
import { getMessageDetail } from "./mail-read-service";
import type { MailActorContext } from "./actor-context";

const env = createCidLocalD1();
let conn: Awaited<ReturnType<typeof env.open>>;
let messageId: string;
const actor: MailActorContext = { userId: CID_TEST_OWNER, crmRole:"staff", sessionId:null, mailAccessEnabled:true, adminGrants:[], audit:{ipAddress:"127.0.0.1",userAgent:"m1f-local-test"} };
before(async () => {
  env.apply(92); conn = await env.open(); process.env.CRM_ALLOW_TEST_DB_BIND="1"; bindTestDatabase(conn.db);
  await seedCidLegacyRows(conn.raw);
  await conn.db.insert(schema.mailUserAccess).values({userId:CID_TEST_OWNER,isEnabled:1,createdAt:CID_TEST_NOW,updatedAt:CID_TEST_NOW});
  await conn.db.insert(schema.mailSenderIdentities).values({id:"m1f-identity",address:"cid-test@example.invalid",defaultMailboxId:"cid-test-box",createdBy:CID_TEST_OWNER,createdAt:CID_TEST_NOW,updatedAt:CID_TEST_NOW});
  await conn.db.insert(schema.mailSenderIdentityGrants).values({id:"m1f-grant",senderIdentityId:"m1f-identity",userId:CID_TEST_OWNER,canReply:1,canSend:1,createdAt:CID_TEST_NOW,updatedAt:CID_TEST_NOW});
  const rawPayloadStore=new MemoryInboundRawPayloadStore(),attachmentStore=new MemoryInboundAttachmentStore();
  const staged=await stageInboundProviderEvent(conn.db,rawPayloadStore,{provider:"m1f-local",providerEventId:"quote",receivedAt:CID_TEST_NOW,envelopeRecipients:["cid-test@example.invalid"],rawPayloadBytes:cidMime({name:"M1F",parts:[{cid:"<Logo@Example>",disposition:"inline"}],html:'<table width="600" style="max-width:100%"><tr><td style="padding:24px;background-color:#eeeeee"><h1>Safe enterprise</h1><img src="cid:Logo@Example" alt="Local logo"><img src="https://canary.invalid/pixel" width="1" height="1"><p>ACTUAL_END_M1F</p></td></tr></table>'})});
  messageId=(await materializeInboundIngestionEvent(conn.db,{rawPayloadStore,attachmentStore},{ingestionEventId:staged.envelopeResults[0].ingestionEventId})).message.id;
});
after(async()=>{await conn?.dispose();});
for (const mode of ["reply","reply_all","forward"] as const) test(`${mode}: actual inbound→seed→autosave→reload→immutable revision preserves layout and closes image delivery`,async()=>{
  const sourceBefore=await getMessageDetail(conn.db,actor,messageId,{folder:"inbox"});
  const draft=await createSeededComposeDraft(conn.db,actor,{sourceMessageId:messageId,mode,folder:"inbox"});
  assert.equal(draft.replyToMessageId,messageId); assert.equal(draft.attachments.length,0);
  assert.match(draft.bodyHtml!,/data-mail-cid-v1/); assert.match(draft.bodyHtml!,/<table width="600"/);
  const saved=await updateDraft(conn.db,actor,{draftId:draft.id,expectedAutosaveVersion:draft.autosaveVersion,bodyHtml:`<p>Synthetic new answer</p>${draft.bodyHtml}`,recipients:mode==="forward"?[{recipientType:"to",address:"forward@example.invalid",sortOrder:0}]:undefined});
  const reloaded=await getDraft(conn.db,actor,saved.id); assert.equal(reloaded.bodyHtml,saved.bodyHtml);
  const revision=await createOutboundRevisionFromDraft(conn.db,actor,{draftId:saved.id,expectedAutosaveVersion:saved.autosaveVersion});
  const [stored]=await conn.db.select().from(schema.mailOutboundRevisions).where(eq(schema.mailOutboundRevisions.id,revision.id));
  assert.match(stored.bodyHtmlSanitized!,/<table width="600"/); assert.match(stored.bodyHtmlSanitized!,/padding:24px/); assert.match(stored.bodyHtmlSanitized!,/Synthetic new answer/);
  assert.match(stored.bodyHtmlSanitized!,/Inline image not included/); assert.match(stored.bodyHtmlSanitized!,/Remote image not included/);
  assert.doesNotMatch(stored.bodyHtmlSanitized!,/data-mail-|canary.invalid|\/api\/mail|<img|src=/);
  assert.equal((await recomputeOutboundRevisionContentHash(conn.db,revision.id)).contentHash,stored.contentHash);
  // Pure payload construction, no transport invocation or external side effects.
  const provider=buildCloudflareEmailOutboundSendRequest({submission:{sendOperationId:"local-unsent",transportAttemptId:"local-unsent",outboundRevisionId:stored.id,rfcMessageId:"<local@example.invalid>",fromAddress:stored.fromAddress,fromDisplayName:stored.fromDisplayName,subject:stored.subject,bodyText:stored.bodyText,bodyHtmlSanitized:stored.bodyHtmlSanitized,signatureBodyText:"Existing signature",signatureBodyHtmlSanitized:"<p>Existing signature</p>",signatureAssets:[],recipients:[{type:"to",address:"synthetic@example.invalid",displayName:null}],attachments:[],inReplyTo:null,referencesHeader:null},attachmentRefs:[]});
  assert.match(provider.html!,/<table width="600"/);assert.equal((provider.html!.match(/Existing signature/g)||[]).length,1);
  assert.doesNotMatch(provider.html!,/data-mail-|canary.invalid|\/api\/mail|<img/);

  assert.equal((await conn.db.select().from(schema.mailOutboundRevisionAttachments).where(eq(schema.mailOutboundRevisionAttachments.revisionId,revision.id))).length,0);
  assert.deepEqual(await getMessageDetail(conn.db,actor,messageId,{folder:"inbox"}),sourceBefore);
});
test("10,003-paragraph quote autosaves below unchanged request limit and reloads complete",async()=>{
  const long = '<p>BEGIN</p>' + '<p>Synthetic long paragraph for M1F.</p>'.repeat(10001) + '<p>END_LONG_M1F</p>';
  const [original]=await conn.db.select().from(schema.mailMessageBodies).where(eq(schema.mailMessageBodies.messageId,messageId));
  await conn.db.update(schema.mailMessageBodies).set({bodyHtmlSanitized:long}).where(eq(schema.mailMessageBodies.messageId,messageId));
  const draft=await createSeededComposeDraft(conn.db,actor,{sourceMessageId:messageId,mode:"reply",folder:"inbox"});
  await conn.db.update(schema.mailMessageBodies).set({bodyHtmlSanitized:original.bodyHtmlSanitized}).where(eq(schema.mailMessageBodies.messageId,messageId));
  // Same DTO contract as API serialization; server and client attachment shapes
  // differ only on fields unused by this empty attachment fixture.
  const state=draftDetailToComposeState({...draft,attachments:[]});
  const payload=buildDraftUpdatePayload({...state,bodyHtml:"<p>New synthetic reply</p>"});
  const request=new Request("http://127.0.0.1/local-test",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...payload,expectedAutosaveVersion:draft.autosaveVersion})});
  const parsed=await readLimitedJsonBody(request,MAIL_API_MAX_JSON_BYTES);assert.equal(parsed.ok,true);assert.ok(JSON.stringify(payload).length<1024);
  const saved=await updateDraft(conn.db,actor,{draftId:draft.id,expectedAutosaveVersion:draft.autosaveVersion,...payload});
  assert.equal((saved.bodyHtml!.match(/Synthetic long paragraph/g)||[]).length,10001);assert.match(saved.bodyHtml!,/END_LONG_M1F/);assert.match(saved.bodyHtml!,/New synthetic reply/);
  assert.equal((await getDraft(conn.db,actor,draft.id)).bodyHtml,saved.bodyHtml);
  await assert.rejects(updateDraft(conn.db,actor,{draftId:draft.id,expectedAutosaveVersion:draft.autosaveVersion,...payload}),(error: unknown) => !!error && typeof error === "object" && "errorCode" in error && error.errorCode === "STALE_VERSION");
  await assert.rejects(updateDraft(conn.db,actor,{draftId:draft.id,expectedAutosaveVersion:saved.autosaveVersion,editableBodyHtml:"<p>x</p>",bodyHtml:"<p>replace quote</p>"}),/combined body/);
  assert.equal((await getDraft(conn.db,actor,draft.id)).bodyHtml,saved.bodyHtml);
});
test("unrelated actor cannot seed a quote or obtain its private resource metadata",async()=>{
  const other={...actor,userId:"cid-test-other"};
  await assert.rejects(createSeededComposeDraft(conn.db,other,{sourceMessageId:messageId,mode:"reply",folder:"inbox"}));
  await assert.rejects(getMessageDetail(conn.db,other,messageId,{folder:"inbox"}));
});
test("no send operation created, existing FK integrity intact",async()=>{
  assert.equal((await conn.raw.prepare("SELECT count(*) AS n FROM mail_send_operations").first())?.n,0);
  assert.deepEqual((await conn.raw.prepare("PRAGMA foreign_key_check").all()).results,[]);
});
