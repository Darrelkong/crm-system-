import { randomBytes, createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getPlatformProxy } from "wrangler";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../drizzle/schema";
import { hashPassword } from "../../src/lib/auth/password";
import { parseInboundMimeBytes } from "../../src/lib/mail/inbound-mime-parser";
import { INBOUND_BODY_HTML_SANITIZER_POLICY_VERSION } from "../../src/lib/mail/inbound-body-html-sanitizer";
import { fixtureMime, readerFixtures, FIXTURE_MAILBOX_ID, FIXTURE_USER_ID } from "./fixtures";

async function main() {
  if (process.argv.slice(2).join(" ") !== "--local") throw new Error("Only --local allowed");
  const root = process.cwd();
  const config = JSON.parse(readFileSync("wrangler.jsonc", "utf8"));
  if (!path.basename(root).startsWith("crm-mail-m1b-") || config.name !== "crm-mail-m1b-local-only" || config.d1_databases?.[0]?.database_id !== "00000000-0000-4000-8000-0000000001b0" || config.d1_databases[0].remote !== false || Object.keys(config).some(k => !["name","compatibility_date","compatibility_flags","d1_databases","r2_buckets","vars"].includes(k))) throw new Error("Not the disposable M1B environment");
  const expectedVars = {
    MAIL_NOTIFICATION_TRANSPORT_ENABLED: "false", MAIL_OUTBOUND_TRANSPORT_MODE: "disabled",
    MAIL_NOTIFICATION_VERIFICATION_TRANSPORT_MODE: "disabled", MAIL_LARGE_ATTACHMENT_RUNTIME_ENABLED: "false",
    MAIL_LARGE_ATTACHMENT_SEND_ENABLED: "false",
  };
  if (config.d1_databases.length !== 1 || config.d1_databases[0].binding !== "DB" ||
      config.r2_buckets?.length !== 1 || config.r2_buckets[0].binding !== "ATTACHMENTS" ||
      config.r2_buckets[0].bucket_name !== "m1b-local-attachments" || config.r2_buckets[0].remote !== false ||
      JSON.stringify(config.vars) !== JSON.stringify(expectedVars)) throw new Error("Unexpected local binding or transport configuration");
  const proxy = await getPlatformProxy<{ DB: CloudflareEnv["DB"]; ATTACHMENTS: CloudflareEnv["ATTACHMENTS"] }>({ configPath: path.join(root,"wrangler.jsonc"), persist: { path: path.join(root,".wrangler/state/v3") } });
  try {
    const db = drizzle(proxy.env.DB, { schema });
    const now = new Date().toISOString();
    const password = randomBytes(24).toString("base64url") + "!aA1";
    const email = "m1b-admin@example.invalid";
    await db.insert(schema.users).values({ id: FIXTURE_USER_ID, email, displayName: "M1B Synthetic Admin", role: "admin", passwordHash: await hashPassword(password), createdAt: now, updatedAt: now });
    await db.insert(schema.mailUserAccess).values({ userId: FIXTURE_USER_ID, isEnabled: 1, enabledAt: now, enabledBy: FIXTURE_USER_ID, createdAt: now, updatedAt: now });
    await db.insert(schema.mailMailboxes).values({ id: FIXTURE_MAILBOX_ID, address: "reader@example.invalid", displayName: "M1B Synthetic Inbox", mailboxType: "personal", createdBy: FIXTURE_USER_ID, createdAt: now, updatedAt: now });
    await db.insert(schema.mailMailboxMembers).values({ id: "m1b-read-membership", mailboxId: FIXTURE_MAILBOX_ID, userId: FIXTURE_USER_ID, canRead: 1, grantedBy: FIXTURE_USER_ID, createdAt: now, updatedAt: now });
    const report = [];
    for (const fixture of readerFixtures()) {
      const mime = fixtureMime(fixture.name, fixture.html);
      const parsed = await parseInboundMimeBytes(mime);
      const id = `m1b-${fixture.name.toLowerCase()}`;
      const threadId = `${id}-thread`;
      await db.insert(schema.mailThreads).values({ id: threadId, mailboxId: FIXTURE_MAILBOX_ID, subjectNormalized: parsed.subject.toLowerCase(), lastMessageAt: now, createdAt: now, updatedAt: now });
      await db.insert(schema.mailMessages).values({ id, threadId, mailboxId: FIXTURE_MAILBOX_ID, direction: "inbound", fromAddress: parsed.fromAddress, fromDisplayName: "Synthetic Sender", subject: parsed.subject, subjectNormalized: parsed.subject.toLowerCase(), previewText: fixture.name, receivedAt: now, createdAt: now, updatedAt: now });
      await db.insert(schema.mailMessageBodies).values({ messageId: id, bodyText: parsed.bodyText, bodyHtmlSanitized: parsed.bodyHtmlSanitized, sanitizationVersion: INBOUND_BODY_HTML_SANITIZER_POLICY_VERSION, createdAt: now, updatedAt: now });
      await db.insert(schema.mailMessageRecipients).values({ id: `${id}-to`, messageId: id, recipientType: "to", address: "reader@example.invalid", sortOrder: 0, createdAt: now });
      if (fixture.end) {
        const bytes = new TextEncoder().encode("M1B synthetic attachment; no real data.\n");
        const hash = createHash("sha256").update(bytes).digest("hex");
        await proxy.env.ATTACHMENTS.put(`m1b/${id}.txt`, bytes);
        await db.insert(schema.mailStoredFiles).values({ id: `${id}-file`, contentHash: hash, originalFilename: "M1B_END_ATTACHMENT.txt", mimeType: "text/plain", sizeBytes: bytes.length, storageProvider: "r2", storageBucket: "m1b-local-attachments", storageKey: `m1b/${id}.txt`, createdAt: now });
        await db.insert(schema.mailMessageAttachments).values({ id: `${id}-attachment`, messageId: id, storedFileId: `${id}-file`, contentHash: hash, originalFilename: "M1B_END_ATTACHMENT.txt", displayFilename: "M1B_END_ATTACHMENT.txt", mimeType: "text/plain", sizeBytes: bytes.length, deliveryMode: "direct_attachment", sortOrder: 0, createdAt: now });
      }
      report.push({ name: fixture.name, id, end: fixture.end, mimeBytes: mime.length, htmlBytes: Buffer.byteLength(parsed.bodyHtmlSanitized ?? ""), textBytes: Buffer.byteLength(parsed.bodyText), htmlHash: createHash("sha256").update(parsed.bodyHtmlSanitized ?? "").digest("hex") });
    }
    writeFileSync("local-login.json", JSON.stringify({ email, password }), { mode: 0o600 });
    writeFileSync("fixture-manifest.json", JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ fixtures: report, user: email, credentialFile: "local-login.json (private; never commit)" }, null, 2));
  } finally { await proxy.dispose(); }
}
main().catch(e => { console.error(e.message); process.exitCode=1; });
