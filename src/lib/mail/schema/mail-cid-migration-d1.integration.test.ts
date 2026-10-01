import assert from "node:assert/strict";
import { test } from "node:test";
import { createCidLocalD1, seedCidLegacyRows } from "../test-fixtures/cid-local-d1";
import { materializeInboundIngestionEvent } from "../inbound-message-materialization-service";
import { MemoryInboundRawPayloadStore } from "../inbound-raw-payload-store";
import { MemoryInboundAttachmentStore } from "../inbound-attachment-store";

for (const start of [86,91]) test(`isolated local D1 ${start} → 0092 preserves old rows, FK and case-sensitive mapping`, async () => {
  const env=createCidLocalD1(); env.apply(start);
  let connection=await env.open();
  try {
    await seedCidLegacyRows(connection.raw);
    const before=(await connection.raw.prepare("SELECT * FROM mail_message_attachments").all()).results;
    if(start===91) await assert.rejects(materializeInboundIngestionEvent(connection.db,{rawPayloadStore:new MemoryInboundRawPayloadStore(),attachmentStore:new MemoryInboundAttachmentStore()},{ingestionEventId:"not-started"}), /content_id_normalized|content_disposition|no such column|Failed query/);
    await connection.dispose();
    for(let version=start+1;version<=92;version++) env.apply(version);
    connection=await env.open(); const db=connection.raw;
    const after=(await db.prepare("SELECT * FROM mail_message_attachments").all()).results;
    assert.deepEqual(after.map(({content_id_normalized,content_disposition,...row}:Record<string,unknown>)=>{assert.equal(content_id_normalized,null);assert.equal(content_disposition,null);return row;}),before);
    const tracked=(await db.prepare("SELECT name FROM d1_migrations WHERE name >= '0087' ORDER BY id").all()).results.map((r:Record<string,unknown>)=>r.name);
    assert.deepEqual(tracked.map((n:unknown)=>String(n).slice(0,4)),["0087","0088","0089","0090","0091","0092"]);
    // Old materializer insert column-list still works after additive migration.
    await db.prepare("INSERT INTO mail_message_attachments(id,message_id,stored_file_id,content_hash,original_filename,display_filename,mime_type,size_bytes,delivery_mode,sort_order,created_at) SELECT 'cid-old-write',message_id,stored_file_id,content_hash,original_filename,display_filename,mime_type,size_bytes,delivery_mode,1,created_at FROM mail_message_attachments WHERE id='cid-old-attachment'").run();
    assert.equal((await db.prepare("SELECT content_id_normalized FROM mail_message_attachments WHERE id='cid-old-write'").first())?.content_id_normalized,null);
    await db.prepare("UPDATE mail_message_attachments SET content_id_normalized='Foo@example',content_disposition='inline'").run();
    assert.equal((await db.prepare("SELECT id FROM mail_message_attachments WHERE message_id='cid-old-message' AND content_id_normalized='Foo@example'").all()).results.length,2);
    assert.equal((await db.prepare("SELECT id FROM mail_message_attachments WHERE content_id_normalized='foo@example'").all()).results.length,0);
    for(const bad of ["","x".repeat(999),"a b","a\tb","a\nb","é","<a@b>","a\0b"]) await assert.rejects(db.prepare("UPDATE mail_message_attachments SET content_id_normalized=? WHERE id='cid-old-attachment'").bind(bad).run());
    await assert.rejects(db.prepare("UPDATE mail_message_attachments SET content_disposition='form-data'").run());
    const plan=(await db.prepare("EXPLAIN QUERY PLAN SELECT id FROM mail_message_attachments WHERE message_id='cid-old-message' AND content_id_normalized='Foo@example'").all()).results;
    assert.match(JSON.stringify(plan),/idx_mail_message_attachments_message_cid/);
    assert.equal((await db.prepare("PRAGMA foreign_key_list(mail_message_attachments)").all()).results.length,6);
    await assert.rejects(db.prepare("UPDATE mail_message_attachments SET content_hash='bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'").run());
    assert.deepEqual((await db.prepare("PRAGMA foreign_key_check").all()).results,[]);
    assert.deepEqual((await db.prepare("PRAGMA quick_check").all()).results,[{quick_check:"ok"}]);
    assert.equal((await db.prepare("SELECT body_html_sanitized FROM mail_message_bodies WHERE message_id='cid-old-message'").first())?.body_html_sanitized,"<p>Old body</p>");
  } finally {await connection.dispose();}
  assert.deepEqual(env.integrity(), [[["ok"]]]);
});
