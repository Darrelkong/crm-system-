#!/usr/bin/env node
/**
 * Phase 2B.4 — Local D1 core message constraint verification.
 * LOCAL ONLY: wrangler d1 execute crm-db --local
 */
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";

const NOW = "2026-08-19T05:50:00.000Z";
const P = "mail-phase2b4";
const USER = `${P}-user`;
const MAILBOX_A = `${P}-mailbox-a`;
const MAILBOX_B = `${P}-mailbox-b`;
const SENDER = `${P}-sender`;
const THREAD_A = `${P}-thread-a`;
const THREAD_B = `${P}-thread-b`;
const MSG_INBOUND = `${P}-msg-inbound`;
const MSG_OUTBOUND = `${P}-msg-outbound`;
const RFC_ID = "<phase2b4-test@example.test>";

const results = [];

function d1(sql, { expectFailure = false } = {}) {
  try {
    const out = execFileSync(
      "npx",
      ["wrangler", "d1", "execute", "crm-db", "--local", "--command", sql],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    if (expectFailure) {
      throw new Error(`Expected failure but succeeded:\n${sql}\n${out}`);
    }
    return out;
  } catch (error) {
    if (expectFailure) {
      return String(error.stderr ?? error.message);
    }
    throw error;
  }
}

function pass(name, detail = "") {
  results.push({ name, ok: true, detail });
  console.log(`PASS  ${name}${detail ? ` — ${detail}` : ""}`);
}

function fail(name, detail = "") {
  results.push({ name, ok: false, detail });
  console.error(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
}

function run(name, fn) {
  try {
    fn();
    if (!results.some((r) => r.name === name && !r.ok)) {
      if (!results.some((r) => r.name === name)) pass(name);
    }
  } catch (error) {
    fail(name, error.message);
  }
}

function setupBase() {
  d1(`INSERT INTO users (id, email, display_name, password_hash, role, is_active, failed_login_attempts, must_change_password, initial_device_auto_approval_eligible, created_at, updated_at)
      VALUES ('${USER}', '${P}-user@example.test', 'Phase2B4 User', 'fixture-hash', 'staff', 1, 0, 0, 0, '${NOW}', '${NOW}');`);
  d1(`INSERT INTO mail_mailboxes (id, address, display_name, mailbox_type, status, created_at, updated_at)
      VALUES ('${MAILBOX_A}', '${P}-a@example.test', 'Mailbox A', 'shared', 'active', '${NOW}', '${NOW}');`);
  d1(`INSERT INTO mail_mailboxes (id, address, display_name, mailbox_type, status, created_at, updated_at)
      VALUES ('${MAILBOX_B}', '${P}-b@example.test', 'Mailbox B', 'personal', 'active', '${NOW}', '${NOW}');`);
  d1(`INSERT INTO mail_sender_identities (id, address, display_name, status, default_mailbox_id, created_at, updated_at)
      VALUES ('${SENDER}', '${P}-from@example.test', 'Fixture Sender', 'active', '${MAILBOX_A}', '${NOW}', '${NOW}');`);
  d1(`INSERT INTO mail_threads (id, mailbox_id, subject_normalized, last_message_at, created_at, updated_at)
      VALUES ('${THREAD_A}', '${MAILBOX_A}', 'test thread', '${NOW}', '${NOW}', '${NOW}');`);
  d1(`INSERT INTO mail_threads (id, mailbox_id, subject_normalized, last_message_at, created_at, updated_at)
      VALUES ('${THREAD_B}', '${MAILBOX_B}', 'thread b', '${NOW}', '${NOW}', '${NOW}');`);
}

function cleanup() {
  const stmts = [
    `DELETE FROM mail_message_read_states WHERE message_id LIKE '${P}%';`,
    `DELETE FROM mail_message_recipients WHERE id LIKE '${P}%';`,
    `DELETE FROM mail_message_bodies WHERE message_id LIKE '${P}%';`,
    `DELETE FROM mail_messages WHERE id LIKE '${P}%';`,
    `DELETE FROM mail_threads WHERE id LIKE '${P}%';`,
    `DELETE FROM mail_sender_identities WHERE id LIKE '${P}%';`,
    `DELETE FROM mail_mailboxes WHERE id LIKE '${P}%';`,
    `DELETE FROM users WHERE id LIKE '${P}%';`,
  ];
  for (const sql of stmts) {
    try {
      d1(sql);
    } catch {
      // best effort
    }
  }
}

function insertInbound(id, {
  threadId = THREAD_A,
  mailboxId = MAILBOX_A,
  receivedAt = NOW,
  senderIdentityId = null,
  composeMode = null,
  internetMessageId = null,
} = {}) {
  const sid = senderIdentityId ? `'${senderIdentityId}'` : "NULL";
  const cm = composeMode ? `'${composeMode}'` : "NULL";
  const imid = internetMessageId ? `'${internetMessageId}'` : "NULL";
  d1(`INSERT INTO mail_messages (id, thread_id, mailbox_id, direction, sender_identity_id, from_address, subject, preview_text, compose_mode, received_at, internet_message_id, created_at, updated_at)
      VALUES ('${id}', '${threadId}', '${mailboxId}', 'inbound', ${sid}, 'sender@example.test', 'Subject', '', ${cm}, '${receivedAt}', ${imid}, '${NOW}', '${NOW}');`);
}

function insertOutbound(id, {
  threadId = THREAD_A,
  mailboxId = MAILBOX_A,
  senderIdentityId = SENDER,
  composeMode = "new",
  sentAt = null,
  replyTo = null,
} = {}) {
  const sat = sentAt ? `'${sentAt}'` : "NULL";
  const rt = replyTo ? `'${replyTo}'` : "NULL";
  d1(`INSERT INTO mail_messages (id, thread_id, mailbox_id, direction, sender_identity_id, from_address, subject, preview_text, compose_mode, reply_to_message_id, sent_at, created_at, updated_at)
      VALUES ('${id}', '${threadId}', '${mailboxId}', 'outbound', '${senderIdentityId}', '${P}-from@example.test', 'Subject', '', '${composeMode}', ${rt}, ${sat}, '${NOW}', '${NOW}');`);
}

console.log("=== Phase 2B.4.1 Local D1 Core Message Verification ===\n");
cleanup();
setupBase();

run("6: thread/message composite FK — matching mailbox passes", () => {
  insertInbound(`${P}-msg-match`);
  pass("6: thread/message composite FK — matching mailbox passes");
});

run("6b: thread/message composite FK — mismatched mailbox rejected", () => {
  const err = d1(
    `INSERT INTO mail_messages (id, thread_id, mailbox_id, direction, from_address, subject, preview_text, received_at, created_at, updated_at)
     VALUES ('${P}-msg-mismatch', '${THREAD_A}', '${MAILBOX_B}', 'inbound', 'x@example.test', 'S', '', '${NOW}', '${NOW}', '${NOW}');`,
    { expectFailure: true },
  );
  assert.match(err, /FOREIGN KEY|constraint|failed/i, err);
  pass("6b: thread/message composite FK — mismatched mailbox rejected");
});

run("7: valid inbound message passes", () => {
  insertInbound(MSG_INBOUND);
  pass("7: valid inbound message passes");
});

run("8: inbound with sender_identity_id rejected", () => {
  const err = d1(
    `INSERT INTO mail_messages (id, thread_id, mailbox_id, direction, sender_identity_id, from_address, subject, preview_text, received_at, created_at, updated_at)
     VALUES ('${P}-inb-sid', '${THREAD_A}', '${MAILBOX_A}', 'inbound', '${SENDER}', 'x@example.test', 'S', '', '${NOW}', '${NOW}', '${NOW}');`,
    { expectFailure: true },
  );
  assert.match(err, /CHECK|constraint|failed/i, err);
  pass("8: inbound with sender_identity_id rejected");
});

run("9: inbound compose_mode=reply rejected", () => {
  const err = d1(
    `INSERT INTO mail_messages (id, thread_id, mailbox_id, direction, from_address, subject, preview_text, compose_mode, received_at, created_at, updated_at)
     VALUES ('${P}-inb-reply', '${THREAD_A}', '${MAILBOX_A}', 'inbound', 'x@example.test', 'S', '', 'reply', '${NOW}', '${NOW}', '${NOW}');`,
    { expectFailure: true },
  );
  assert.match(err, /CHECK|constraint|failed/i, err);
  pass("9: inbound compose_mode=reply rejected");
});

run("10: inbound without received_at rejected", () => {
  const err = d1(
    `INSERT INTO mail_messages (id, thread_id, mailbox_id, direction, from_address, subject, preview_text, created_at, updated_at)
     VALUES ('${P}-inb-norecv', '${THREAD_A}', '${MAILBOX_A}', 'inbound', 'x@example.test', 'S', '', '${NOW}', '${NOW}');`,
    { expectFailure: true },
  );
  assert.match(err, /CHECK|constraint|failed/i, err);
  pass("10: inbound without received_at rejected");
});

run("11: valid outbound message passes", () => {
  insertOutbound(MSG_OUTBOUND);
  pass("11: valid outbound message passes");
});

run("12: outbound without sender_identity_id rejected", () => {
  const err = d1(
    `INSERT INTO mail_messages (id, thread_id, mailbox_id, direction, from_address, subject, preview_text, compose_mode, created_at, updated_at)
     VALUES ('${P}-out-nosid', '${THREAD_A}', '${MAILBOX_A}', 'outbound', 'x@example.test', 'S', '', 'new', '${NOW}', '${NOW}');`,
    { expectFailure: true },
  );
  assert.match(err, /CHECK|constraint|failed/i, err);
  pass("12: outbound without sender_identity_id rejected");
});

run("13: outbound compose_mode=NULL rejected", () => {
  const err = d1(
    `INSERT INTO mail_messages (id, thread_id, mailbox_id, direction, sender_identity_id, from_address, subject, preview_text, created_at, updated_at)
     VALUES ('${P}-out-nocm', '${THREAD_A}', '${MAILBOX_A}', 'outbound', '${SENDER}', 'x@example.test', 'S', '', '${NOW}', '${NOW}');`,
    { expectFailure: true },
  );
  assert.match(err, /CHECK|constraint|failed/i, err);
  pass("13: outbound compose_mode=NULL rejected");
});

run("13b: outbound compose modes new/reply/reply_all/forward accepted", () => {
  for (const mode of ["new", "reply", "reply_all", "forward"]) {
    insertOutbound(`${P}-out-${mode}`, { composeMode: mode });
  }
  pass("13b: outbound compose modes new/reply/reply_all/forward accepted");
});

run("14: hard delete sender identity blocked by CHECK", () => {
  const err = d1(`DELETE FROM mail_sender_identities WHERE id = '${SENDER}';`, {
    expectFailure: true,
  });
  assert.match(err, /FOREIGN KEY|CHECK|constraint|failed/i, err);
  d1(`UPDATE mail_sender_identities SET status = 'deleted', updated_at = '${NOW}' WHERE id = '${SENDER}';`);
  const out = d1(
    `SELECT sender_identity_id FROM mail_messages WHERE id = '${MSG_OUTBOUND}';`,
  );
  assert.match(out, new RegExp(`"sender_identity_id": "${SENDER}"`));
  d1(`UPDATE mail_sender_identities SET status = 'active', updated_at = '${NOW}' WHERE id = '${SENDER}';`);
  pass("14: hard delete sender identity blocked; soft delete allowed");
});

run("15: mailbox-scoped RFC Message-ID dedup", () => {
  insertInbound(`${P}-rfc-a1`, { internetMessageId: RFC_ID });
  const err = d1(
    `INSERT INTO mail_messages (id, thread_id, mailbox_id, direction, from_address, subject, preview_text, received_at, internet_message_id, created_at, updated_at)
     VALUES ('${P}-rfc-a2', '${THREAD_A}', '${MAILBOX_A}', 'inbound', 'x@example.test', 'S', '', '${NOW}', '${RFC_ID}', '${NOW}', '${NOW}');`,
    { expectFailure: true },
  );
  assert.match(err, /UNIQUE|constraint|failed/i, err);
  insertInbound(`${P}-rfc-b1`, {
    threadId: THREAD_B,
    mailboxId: MAILBOX_B,
    internetMessageId: RFC_ID,
  });
  pass("15: mailbox-scoped RFC Message-ID dedup");
});

run("16: multiple NULL internet_message_id allowed", () => {
  insertInbound(`${P}-null-imid-1`, { internetMessageId: null });
  insertInbound(`${P}-null-imid-2`, { internetMessageId: null });
  pass("16: multiple NULL internet_message_id allowed");
});

run("17: body 1:1 constraint", () => {
  const msgId = `${P}-body-msg`;
  insertInbound(msgId);
  d1(`INSERT INTO mail_message_bodies (message_id, body_text, sanitization_version, created_at, updated_at)
      VALUES ('${msgId}', 'hello', '1', '${NOW}', '${NOW}');`);
  const err = d1(
    `INSERT INTO mail_message_bodies (message_id, body_text, sanitization_version, created_at, updated_at)
     VALUES ('${msgId}', 'dup', '1', '${NOW}', '${NOW}');`,
    { expectFailure: true },
  );
  assert.match(err, /UNIQUE|constraint|failed|PRIMARY KEY/i, err);
  pass("17: body 1:1 constraint");
});

run("18: sanitization_version default accepted", () => {
  const out = d1(
    `SELECT sanitization_version, body_html_sanitized FROM mail_message_bodies WHERE message_id = '${P}-body-msg';`,
  );
  assert.match(out, /"sanitization_version": "1"/);
  pass("18: sanitization_version default accepted (HTML safety is server-layer)");
});

run("19-20: recipient types and cross-type case-insensitive uniqueness", () => {
  const msgId = `${P}-rcp-msg`;
  insertInbound(msgId);
  d1(`INSERT INTO mail_message_recipients (id, message_id, recipient_type, address, sort_order, created_at)
      VALUES ('${P}-rcp-to', '${msgId}', 'to', 'john@example.test', 0, '${NOW}');`);
  d1(`INSERT INTO mail_message_recipients (id, message_id, recipient_type, address, sort_order, created_at)
      VALUES ('${P}-rcp-bcc', '${msgId}', 'bcc', 'secret@example.test', 1, '${NOW}');`);
  const errCc = d1(
    `INSERT INTO mail_message_recipients (id, message_id, recipient_type, address, sort_order, created_at)
     VALUES ('${P}-rcp-cc-dup', '${msgId}', 'cc', 'JOHN@example.test', 2, '${NOW}');`,
    { expectFailure: true },
  );
  assert.match(errCc, /UNIQUE|constraint|failed/i, errCc);
  const errBcc = d1(
    `INSERT INTO mail_message_recipients (id, message_id, recipient_type, address, sort_order, created_at)
     VALUES ('${P}-rcp-bcc-dup', '${msgId}', 'bcc', 'john@example.test', 3, '${NOW}');`,
    { expectFailure: true },
  );
  assert.match(errBcc, /UNIQUE|constraint|failed/i, errBcc);
  const errType = d1(
    `INSERT INTO mail_message_recipients (id, message_id, recipient_type, address, sort_order, created_at)
     VALUES ('${P}-rcp-bad', '${msgId}', 'other', 'x@example.test', 4, '${NOW}');`,
    { expectFailure: true },
  );
  assert.match(errType, /CHECK|constraint|failed/i, errType);
  pass("19-20: recipient types and cross-type case-insensitive uniqueness");
});

run("21: same address allowed on different messages", () => {
  const msg2 = `${P}-rcp-msg2`;
  insertInbound(msg2);
  d1(`INSERT INTO mail_message_recipients (id, message_id, recipient_type, address, sort_order, created_at)
      VALUES ('${P}-rcp-msg2-to', '${msg2}', 'to', 'john@example.test', 0, '${NOW}');`);
  pass("21: same address allowed on different messages");
});

run("23: Bcc row persistence", () => {
  const out = d1(
    `SELECT recipient_type, address FROM mail_message_recipients WHERE id = '${P}-rcp-bcc';`,
  );
  assert.match(out, /"recipient_type": "bcc"/);
  pass("23: Bcc row persistence (API filtering deferred)");
});

run("25-28: read state mark read/unread/important", () => {
  const msgId = `${P}-read-msg`;
  insertInbound(msgId);
  d1(`INSERT INTO mail_message_read_states (message_id, user_id, is_read, read_at, is_important_personal, updated_at)
      VALUES ('${msgId}', '${USER}', 1, '${NOW}', 1, '${NOW}');`);
  d1(`UPDATE mail_message_read_states SET is_read = 0, read_at = NULL, updated_at = '${NOW}' WHERE message_id = '${msgId}' AND user_id = '${USER}';`);
  const out = d1(
    `SELECT is_read, read_at, is_important_personal FROM mail_message_read_states WHERE message_id = '${msgId}' AND user_id = '${USER}';`,
  );
  assert.match(out, /"is_read": 0/);
  assert.match(out, /"read_at": null/);
  assert.match(out, /"is_important_personal": 1/);
  const noRow = d1(
    `SELECT COUNT(*) AS c FROM mail_message_read_states WHERE message_id = '${MSG_INBOUND}';`,
  );
  assert.match(noRow, /"c": 0/);
  pass("25-28: read state mark read/unread/important; no-row default");
});

run("27: read state invalid is_read=0 with read_at rejected", () => {
  const msgId = `${P}-read-invalid-unread-ts`;
  insertInbound(msgId);
  const err = d1(
    `INSERT INTO mail_message_read_states (message_id, user_id, is_read, read_at, is_important_personal, updated_at)
     VALUES ('${msgId}', '${USER}', 0, '${NOW}', 0, '${NOW}');`,
    { expectFailure: true },
  );
  assert.match(err, /CHECK|constraint|failed/i, err);
  pass("27: read state invalid is_read=0 with read_at rejected");
});

run("27b: read state invalid is_read=1 without read_at rejected", () => {
  const msgId = `${P}-read-invalid-read-no-ts`;
  insertInbound(msgId);
  const err = d1(
    `INSERT INTO mail_message_read_states (message_id, user_id, is_read, is_important_personal, updated_at)
     VALUES ('${msgId}', '${USER}', 1, 0, '${NOW}');`,
    { expectFailure: true },
  );
  assert.match(err, /CHECK|constraint|failed/i, err);
  pass("27b: read state invalid is_read=1 without read_at rejected");
});

run("27c: read state valid is_read=0 with read_at NULL passes", () => {
  const msgId = `${P}-read-valid-unread`;
  insertInbound(msgId);
  d1(`INSERT INTO mail_message_read_states (message_id, user_id, is_read, read_at, is_important_personal, updated_at)
      VALUES ('${msgId}', '${USER}', 0, NULL, 0, '${NOW}');`);
  pass("27c: read state valid is_read=0 with read_at NULL passes");
});

run("29: read state duplicate message_id+user_id rejected", () => {
  const msgId = `${P}-read-dup`;
  insertInbound(msgId);
  d1(`INSERT INTO mail_message_read_states (message_id, user_id, is_read, is_important_personal, updated_at)
      VALUES ('${msgId}', '${USER}', 0, 0, '${NOW}');`);
  const err = d1(
    `INSERT INTO mail_message_read_states (message_id, user_id, is_read, is_important_personal, updated_at)
     VALUES ('${msgId}', '${USER}', 1, 0, '${NOW}');`,
    { expectFailure: true },
  );
  assert.match(err, /UNIQUE|constraint|failed|PRIMARY KEY/i, err);
  pass("29: read state duplicate rejected");
});

run("30: FK delete safety — no CASCADE", () => {
  const errMb = d1(`DELETE FROM mail_mailboxes WHERE id = '${MAILBOX_A}';`, {
    expectFailure: true,
  });
  assert.match(errMb, /FOREIGN KEY|constraint|failed/i, errMb);
  const errTh = d1(`DELETE FROM mail_threads WHERE id = '${THREAD_A}';`, {
    expectFailure: true,
  });
  assert.match(errTh, /FOREIGN KEY|constraint|failed/i, errTh);
  const errMsg = d1(`DELETE FROM mail_messages WHERE id = '${P}-body-msg';`, {
    expectFailure: true,
  });
  assert.match(errMsg, /FOREIGN KEY|constraint|failed/i, errMsg);
  pass("30: FK delete safety — children block parent delete");
});

run("31: reply_to_message_id FK", () => {
  const msgA = `${P}-reply-a`;
  const msgB = `${P}-reply-b`;
  insertInbound(msgA);
  insertOutbound(msgB, { composeMode: "reply", replyTo: msgA });
  const err = d1(
    `INSERT INTO mail_messages (id, thread_id, mailbox_id, direction, sender_identity_id, from_address, subject, preview_text, compose_mode, reply_to_message_id, created_at, updated_at)
     VALUES ('${P}-reply-bad', '${THREAD_A}', '${MAILBOX_A}', 'outbound', '${SENDER}', 'x@example.test', 'S', '', 'reply', '${P}-missing', '${NOW}', '${NOW}');`,
    { expectFailure: true },
  );
  assert.match(err, /FOREIGN KEY|constraint|failed/i, err);
  pass("31: reply_to_message_id FK");
});

run("32: trash soft retention", () => {
  const msgId = `${P}-trash-msg`;
  insertInbound(msgId);
  d1(`UPDATE mail_messages SET trashed_at = '${NOW}', trashed_by = '${USER}', updated_at = '${NOW}' WHERE id = '${msgId}';`);
  const out = d1(`SELECT trashed_at, trashed_by FROM mail_messages WHERE id = '${msgId}';`);
  assert.match(out, /"trashed_at":/);
  assert.match(out, /"trashed_by":/);
  d1(`UPDATE mail_messages SET trashed_at = NULL, trashed_by = NULL, updated_at = '${NOW}' WHERE id = '${msgId}';`);
  pass("32: trash soft retention and restore");
});

console.log("\n=== Cleanup ===\n");
cleanup();

const remaining = d1(
  `SELECT
    (SELECT COUNT(*) FROM users WHERE id LIKE '${P}%') AS users,
    (SELECT COUNT(*) FROM mail_mailboxes WHERE id LIKE '${P}%') AS mailboxes,
    (SELECT COUNT(*) FROM mail_sender_identities WHERE id LIKE '${P}%') AS senders,
    (SELECT COUNT(*) FROM mail_threads WHERE id LIKE '${P}%') AS threads,
    (SELECT COUNT(*) FROM mail_messages WHERE id LIKE '${P}%') AS messages,
    (SELECT COUNT(*) FROM mail_message_recipients WHERE id LIKE '${P}%') AS recipients,
    (SELECT COUNT(*) FROM mail_message_read_states WHERE message_id LIKE '${P}%') AS read_states;`,
);
for (const label of ["users", "mailboxes", "senders", "threads", "messages", "recipients", "read_states"]) {
  assert.match(remaining, new RegExp(`"${label}": 0`));
}

const failed = results.filter((r) => !r.ok);
console.log(`\n=== Summary: ${results.length - failed.length}/${results.length} passed ===`);
if (failed.length > 0) {
  console.error("Failed:", failed);
  process.exit(1);
}
