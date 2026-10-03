/** Enables compose only for the established disposable synthetic M1 browser actor. No transport. */
import { readFileSync } from "node:fs";
import path from "node:path";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "../../drizzle/schema";
import { FIXTURE_MAILBOX_ID, FIXTURE_USER_ID } from "./fixtures";
async function main(){
 if(process.argv.slice(2).join(" ")!=="--local")throw new Error("Only --local allowed");
 const config=JSON.parse(readFileSync("wrangler.jsonc","utf8"));
 const expected={name:"crm-mail-m1b-local-only",compatibility_date:"2026-09-01",compatibility_flags:["nodejs_compat"],d1_databases:[{binding:"DB",database_name:"m1b-local",database_id:"00000000-0000-4000-8000-0000000001b0",migrations_dir:"drizzle/migrations",remote:false}],r2_buckets:[{binding:"ATTACHMENTS",bucket_name:"m1b-local-attachments",remote:false}],vars:{MAIL_NOTIFICATION_TRANSPORT_ENABLED:"false",MAIL_OUTBOUND_TRANSPORT_MODE:"disabled",MAIL_NOTIFICATION_VERIFICATION_TRANSPORT_MODE:"disabled",MAIL_LARGE_ATTACHMENT_RUNTIME_ENABLED:"false",MAIL_LARGE_ATTACHMENT_SEND_ENABLED:"false"}};
 if(!path.basename(process.cwd()).startsWith("crm-mail-m1b-")||JSON.stringify(config)!==JSON.stringify(expected))throw new Error("Not exact local M1 fixture");

 const proxy=await getPlatformProxy<{DB:CloudflareEnv["DB"]}>({configPath:path.resolve("wrangler.jsonc"),persist:{path:path.resolve(".wrangler/state/v3")}});
 try {
  const db=drizzle(proxy.env.DB,{schema}),now=new Date().toISOString();
  await db.insert(schema.mailSenderIdentities).values({id:"m1f-local-identity",address:"reader@example.invalid",displayName:"Synthetic M1F",defaultMailboxId:FIXTURE_MAILBOX_ID,createdBy:FIXTURE_USER_ID,createdAt:now,updatedAt:now}).onConflictDoNothing();
  await db.insert(schema.mailSenderIdentityGrants).values({id:"m1f-local-grant",senderIdentityId:"m1f-local-identity",userId:FIXTURE_USER_ID,canReply:1,canSend:1,createdAt:now,updatedAt:now}).onConflictDoNothing();
  console.log("Disposable synthetic compose identity ready; transport disabled; no messages sent.");
 }finally{await proxy.dispose();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
