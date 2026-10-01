/** New messages only: real MIME→staging→materialization→local D1/private emulated R2. */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "../../drizzle/schema";
import { R2InboundAttachmentStore } from "../../src/lib/mail/inbound-attachment-store";
import { MemoryInboundRawPayloadStore } from "../../src/lib/mail/inbound-raw-payload-store";
import { stageInboundProviderEvent } from "../../src/lib/mail/inbound-provider-staging-service";
import { materializeInboundIngestionEvent } from "../../src/lib/mail/inbound-message-materialization-service";
import { cidFixtures, cidMime } from "./cid-fixtures";
import { FIXTURE_MAILBOX_ID } from "./fixtures";
async function main(){
 if(process.argv.slice(2).join(" ")!=="--local")throw new Error("Only --local allowed");
 const config=JSON.parse(readFileSync("wrangler.jsonc","utf8"));
 const expected={name:"crm-mail-m1b-local-only",compatibility_date:"2026-09-01",compatibility_flags:["nodejs_compat"],d1_databases:[{binding:"DB",database_name:"m1b-local",database_id:"00000000-0000-4000-8000-0000000001b0",migrations_dir:"drizzle/migrations",remote:false}],r2_buckets:[{binding:"ATTACHMENTS",bucket_name:"m1b-local-attachments",remote:false}],vars:{MAIL_NOTIFICATION_TRANSPORT_ENABLED:"false",MAIL_OUTBOUND_TRANSPORT_MODE:"disabled",MAIL_NOTIFICATION_VERIFICATION_TRANSPORT_MODE:"disabled",MAIL_LARGE_ATTACHMENT_RUNTIME_ENABLED:"false",MAIL_LARGE_ATTACHMENT_SEND_ENABLED:"false"}};
 if(!path.basename(process.cwd()).startsWith("crm-mail-m1b-")||JSON.stringify(config)!==JSON.stringify(expected))throw new Error("Not exact local M1 fixture");
 const proxy=await getPlatformProxy<{DB:CloudflareEnv["DB"];ATTACHMENTS:CloudflareEnv["ATTACHMENTS"]}>({configPath:path.resolve("wrangler.jsonc"),persist:{path:path.resolve(".wrangler/state/v3")}});
 try{
  const db=drizzle(proxy.env.DB,{schema}),now=new Date().toISOString();
  const [box]=await db.select().from(schema.mailMailboxes).where(eq(schema.mailMailboxes.id,FIXTURE_MAILBOX_ID));if(!box)throw new Error("Existing synthetic mailbox required");
  // Local-only receiving route for the already-established synthetic mailbox.
  await db.insert(schema.mailReceivingAddresses).values({id:"m1ec-local-route",mailboxId:box.id,address:box.address,addressType:"primary",status:"active",createdAt:now,updatedAt:now}).onConflictDoNothing();
  const rawPayloadStore=new MemoryInboundRawPayloadStore(),attachmentStore=new R2InboundAttachmentStore(proxy.env.ATTACHMENTS,"m1b-local-attachments"),report=[];
  for(const fixture of cidFixtures()){
   const rfcId=`<${fixture.name}@cid-test.invalid>`;
   if((await db.select().from(schema.mailMessages).where(eq(schema.mailMessages.internetMessageId,rfcId))).length)throw new Error("Fixture already materialized; never overwrite history");
   const staged=await stageInboundProviderEvent(db,rawPayloadStore,{provider:"m1ec-local",providerEventId:fixture.name,receivedAt:now,rawPayloadBytes:cidMime(fixture),envelopeRecipients:[box.address]});
   const result=await materializeInboundIngestionEvent(db,{rawPayloadStore,attachmentStore},{ingestionEventId:staged.envelopeResults[0].ingestionEventId});
   const [body]=await db.select().from(schema.mailMessageBodies).where(eq(schema.mailMessageBodies.messageId,result.message.id));
   const attachments=await db.select({id:schema.mailMessageAttachments.id,cid:schema.mailMessageAttachments.contentIdNormalized,disposition:schema.mailMessageAttachments.contentDisposition}).from(schema.mailMessageAttachments).where(eq(schema.mailMessageAttachments.messageId,result.message.id));
   report.push({name:fixture.name,id:result.message.id,end:fixture.end,loaded:fixture.loaded,unavailable:fixture.unavailable,version:body.sanitizationVersion,html:body.bodyHtmlSanitized,attachments});
  }
  writeFileSync("m1ec-fixture-manifest.json",JSON.stringify(report,null,2));console.log(JSON.stringify(report.map(({name,id,version})=>({name,id,version}))));
 }finally{await proxy.dispose();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
