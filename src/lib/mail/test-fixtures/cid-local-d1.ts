/** Disposable D1 only. No remote identities, service bindings or credential inheritance. */
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { getPlatformProxy } from "wrangler";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../../../drizzle/schema";

export function createCidLocalD1() {
  const root = mkdtempSync(join(tmpdir(), "crm-mail-cid-test-"));
  const migrations = join(root, "migrations"); mkdirSync(migrations);
  const configPath = join(root, "wrangler.json");
  writeFileSync(configPath, JSON.stringify({name:"crm-cid-local-test",compatibility_date:"2026-09-01",compatibility_flags:["nodejs_compat"],d1_databases:[{binding:"DB",database_name:"cid-local",database_id:"00000000-0000-4000-8000-000000000092",migrations_dir:migrations,remote:false}]}));
  const cli = resolve("node_modules/wrangler/wrangler-dist/cli.js");
  return {
    root,
    apply(max: number) {
      for (const file of readdirSync("drizzle/migrations").sort()) if (/^\d{4}.*\.sql$/.test(file) && Number(file.slice(0,4)) <= max) cpSync(join("drizzle/migrations",file),join(migrations,file));
      execFileSync(process.execPath,[cli,"d1","migrations","apply","cid-local","--local","--config",configPath,"--persist-to",join(root,"state")],{encoding:"utf8",maxBuffer:64*1024*1024,env:{NODE_ENV:"test",HOME:process.env.HOME,PATH:process.env.PATH,TMPDIR:process.env.TMPDIR,WRANGLER_SEND_METRICS:"false"},stdio:["ignore","pipe","pipe"]});
    },
    integrity() {
      // D1 permits quick_check but not integrity_check. Inspect only the closed,
      // disposable local SQLite file read-only; no remote D1 or schema mutation.
      const output = execFileSync("python3", ["-c", "import sqlite3,pathlib,json,sys; result=[]\nfor p in pathlib.Path(sys.argv[1]).rglob('*.sqlite'):\n c=sqlite3.connect(p.as_uri()+'?mode=ro',uri=True)\n if c.execute(\"SELECT 1 FROM sqlite_master WHERE name='mail_message_attachments'\").fetchone(): result.append(c.execute('PRAGMA integrity_check').fetchall())\n c.close()\nprint(json.dumps(result))", root], { encoding: "utf8" });
      return JSON.parse(output);
    },
    async open() {
      const proxy = await getPlatformProxy<{DB:CloudflareEnv["DB"]}>({configPath,persist:{path:join(root,"state/v3")}});
      return {raw:proxy.env.DB, db:drizzle(proxy.env.DB,{schema}), dispose:proxy.dispose};
    },
  };
}

export const CID_TEST_NOW = "2026-10-02T00:00:00.000Z";
export const CID_TEST_OWNER = "cid-test-owner";
export async function seedCidLegacyRows(db: CloudflareEnv["DB"]) {
  // Explicit pre-0092 writes: also proves old-app inserts remain compatible.
  const statements = [
    "INSERT INTO users(id,email,display_name,password_hash,role,created_at,updated_at) VALUES('cid-test-owner','owner@example.invalid','Synthetic CID owner','disabled','staff','2026-10-02','2026-10-02')",
    "INSERT INTO users(id,email,display_name,password_hash,role,created_at,updated_at) VALUES('cid-test-other','other@example.invalid','Synthetic unrelated actor','disabled','staff','2026-10-02','2026-10-02')",
    "INSERT INTO mail_mailboxes(id,address,mailbox_type,created_by,created_at,updated_at) VALUES('cid-test-box','cid-test@example.invalid','personal','cid-test-owner','2026-10-02','2026-10-02')",
    "INSERT INTO mail_receiving_addresses(id,mailbox_id,address,address_type,status,created_at,updated_at) VALUES('cid-test-route','cid-test-box','cid-test@example.invalid','primary','active','2026-10-02','2026-10-02')",
    "INSERT INTO mail_threads(id,mailbox_id,last_message_at,created_at,updated_at) VALUES('cid-old-thread','cid-test-box','2026-10-02','2026-10-02','2026-10-02')",
    "INSERT INTO mail_messages(id,thread_id,mailbox_id,direction,from_address,subject,preview_text,received_at,created_at,updated_at) VALUES('cid-old-message','cid-old-thread','cid-test-box','inbound','sender@example.invalid','Old mail','Old body','2026-10-02','2026-10-02','2026-10-02')",
    "INSERT INTO mail_message_bodies(message_id,body_text,body_html_sanitized,sanitization_version,created_at,updated_at) VALUES('cid-old-message','Old body','<p>Old body</p>','inbound-v2','2026-10-02','2026-10-02')",
    "INSERT INTO mail_stored_files(id,content_hash,original_filename,mime_type,size_bytes,storage_provider,storage_bucket,storage_key,created_at) VALUES('cid-old-file','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','old.png','image/png',8,'r2','local-only','cid-test/old.png','2026-10-02')",
    "INSERT INTO mail_message_attachments(id,message_id,stored_file_id,content_hash,original_filename,display_filename,mime_type,size_bytes,delivery_mode,sort_order,created_at) VALUES('cid-old-attachment','cid-old-message','cid-old-file','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','old.png','old.png','image/png',8,'direct_attachment',0,'2026-10-02')",
  ];
  await db.batch(statements.map(sql=>db.prepare(sql)));
}
