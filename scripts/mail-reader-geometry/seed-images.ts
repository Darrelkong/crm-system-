/** Add new v4 image fixtures to the same isolated local DB; never rewrite history. */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getPlatformProxy } from "wrangler";
import { parseInboundMimeBytes } from "../../src/lib/mail/inbound-mime-parser";
import { INBOUND_BODY_HTML_SANITIZER_POLICY_VERSION } from "../../src/lib/mail/inbound-body-html-sanitizer";
import { fixtureMime, FIXTURE_MAILBOX_ID } from "./fixtures";
import { imageFixtures } from "./image-fixtures";
async function main() {
  const args = process.argv.slice(2).join(" ");
  if (args !== "--local") throw new Error("Only explicit local fixture modes allowed");
  const config = JSON.parse(readFileSync("wrangler.jsonc", "utf8"));
  const expected = {name:"crm-mail-m1b-local-only",compatibility_date:"2026-09-01",compatibility_flags:["nodejs_compat"],d1_databases:[{binding:"DB",database_name:"m1b-local",database_id:"00000000-0000-4000-8000-0000000001b0",migrations_dir:"drizzle/migrations",remote:false}],r2_buckets:[{binding:"ATTACHMENTS",bucket_name:"m1b-local-attachments",remote:false}],vars:{MAIL_NOTIFICATION_TRANSPORT_ENABLED:"false",MAIL_OUTBOUND_TRANSPORT_MODE:"disabled",MAIL_NOTIFICATION_VERIFICATION_TRANSPORT_MODE:"disabled",MAIL_LARGE_ATTACHMENT_RUNTIME_ENABLED:"false",MAIL_LARGE_ATTACHMENT_SEND_ENABLED:"false"}};
  if (!path.basename(process.cwd()).startsWith("crm-mail-m1b-") || JSON.stringify(config)!==JSON.stringify(expected)) throw new Error("Not exact isolated M1B fixture");
  const proxy = await getPlatformProxy<{DB: CloudflareEnv["DB"]}>({configPath:path.resolve("wrangler.jsonc"),persist:{path:path.resolve(".wrangler/state/v3")}});
  try {
    const db=proxy.env.DB, now=new Date().toISOString(), report=[];
    for (const fixture of imageFixtures()) {
      const id=`m1e-${fixture.name.toLowerCase()}`, thread=`${id}-thread`;
      if(await db.prepare("SELECT id FROM mail_messages WHERE id=?").bind(id).first()) throw new Error("Fixture already exists; do not overwrite");
      const mime = fixtureMime(fixture.name, fixture.html);
      const parsed=await parseInboundMimeBytes(mime);
      const version = INBOUND_BODY_HTML_SANITIZER_POLICY_VERSION;
      await db.batch([
        db.prepare("INSERT INTO mail_threads(id,mailbox_id,subject_normalized,last_message_at,created_at,updated_at) VALUES(?,?,?,?,?,?)").bind(thread,FIXTURE_MAILBOX_ID,parsed.subject.toLowerCase(),now,now,now),
        db.prepare("INSERT INTO mail_messages(id,thread_id,mailbox_id,direction,from_address,from_display_name,subject,subject_normalized,preview_text,received_at,created_at,updated_at) VALUES(?,?,?,'inbound',?,?,?,?,?,?,?,?)").bind(id,thread,FIXTURE_MAILBOX_ID,parsed.fromAddress,"Synthetic Sender",parsed.subject,parsed.subject.toLowerCase(),fixture.name,now,now,now),
        db.prepare("INSERT INTO mail_message_bodies(message_id,body_text,body_html_sanitized,sanitization_version,created_at,updated_at) VALUES(?,?,?,?,?,?)").bind(id,parsed.bodyText,parsed.bodyHtmlSanitized,version,now,now),
        db.prepare("INSERT INTO mail_message_recipients(id,message_id,recipient_type,address,sort_order,created_at) VALUES(?,?,'to','reader@example.invalid',0,?)").bind(`${id}-to`,id,now),
      ]);
      // Fixed ASCII fixture contract; browser computes the same checksum in-document.
      const text=(parsed.bodyHtmlSanitized ?? "").replace(/<[^>]*>/g, "").replace(/\r\n?/g, "\n");
      let checksum=2166136261;
      for(let i=0;i<text.length;i++) checksum=Math.imul(checksum^text.charCodeAt(i),16777619);
      report.push({name:fixture.name,id,end:fixture.end,version,html:parsed.bodyHtmlSanitized,textFingerprint:`${text.length}:${checksum>>>0}`});
    }
    writeFileSync("m1e-fixture-manifest.json",JSON.stringify(report,null,2));
    console.log(JSON.stringify(report.map(({name,id,version})=>({name,id,version}))));
  } finally {await proxy.dispose();}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
