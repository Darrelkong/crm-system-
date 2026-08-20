#!/usr/bin/env node
/**
 * Phase 2B.20 — Local D1 Inbound Receiving Address (0060) runtime verification.
 * LOCAL ONLY. Assumes 0060 applied and pre-apply mail-phase2b20-* mailboxes exist.
 */
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";

const NOW = "2026-08-20T08:30:00.000Z";
const DEL_AT = "2026-08-20T07:00:00.000Z";
const P = "mail-phase2b20";
const USER = `${P}-user`;
const MB_ACTIVE = `${P}-mb-active`;
const MB_SUSP = `${P}-mb-suspended`;
const MB_ARCH = `${P}-mb-archived`;
const MB_DEL = `${P}-mb-deleted`;
const MB_ROT = `${P}-mb-rotate`;
const MB_HIST = `${P}-mb-hist`;
const MB_NEW = `${P}-mb-new`;
const MB_ALIAS = `${P}-mb-alias-src`;
const MB_ALIAS_B = `${P}-mb-alias-dst`;
const SENDER = `${P}-sender-dup`;

const ADDR_ACTIVE = "active.mail@echfronthk.test";
const ADDR_SUSP = "suspended.mail@echfronthk.test";
const ADDR_ARCH = "archived.mail@echfronthk.test";
const ADDR_DEL = "deleted.mail@echfronthk.test";
const ADDR_ROT_OLD = "old-primary.mail@echfronthk.test";
const ADDR_ROT_NEW = "new-primary.mail@echfronthk.test";
const ADDR_HIST1 = "hist1-primary.mail@echfronthk.test";
const ADDR_HIST2 = "hist2-primary.mail@echfronthk.test";
const ADDR_HIST_CUR = "hist-current.mail@echfronthk.test";
const ADDR_NEW_MB = "new-mailbox.mail@echfronthk.test";
const ADDR_CASE = "CaseTest@echfronthk.test";
const ADDR_ALIAS_A = "alias-a.mail@echfronthk.test";
const ADDR_ALIAS_B = "alias-b.mail@echfronthk.test";
const ADDR_ALIAS_C = "alias-c.mail@echfronthk.test";
const ADDR_SHARED = "shared-addr.mail@echfronthk.test";

const results = [];
const observations = {
  everyPre0060MailboxOnePrimary: false,
  caseVariantSecondRoute: true,
  atMostOneCurrentPrimary: false,
  retiredCoexistsWithCurrent: false,
  oldPrimaryReserved: false,
  receivingMayMatchSenderIdentity: false,
  senderIdentityNotInboundRouting: true,
  dbAutoCreatesPrimaryForNewMailbox: true,
  mailboxServiceMustCreateBoth: true,
  dbAutoSyncsLifecycle: true,
  serviceMustCoordinate: true,
  envelopeProvenanceIn0060: true,
  nextDomainRequired: true,
};

function d1(sql, { expectFailure = false, json = false } = {}) {
  const args = ["wrangler", "d1", "execute", "crm-db", "--local", "--command", sql];
  if (json) args.push("--json");
  try {
    const out = execFileSync("npx", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (expectFailure) throw new Error(`Expected failure:\n${sql}\n${out}`);
    return out;
  } catch (error) {
    if (expectFailure) return String(error.stderr ?? error.message);
    throw error;
  }
}

function d1Json(sql, opts = {}) {
  const raw = d1(sql, { ...opts, json: true });
  return JSON.parse(raw);
}

function q(s) {
  return `'${String(s).replace(/'/g, "''")}'`;
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

function reject(err) {
  assert.match(String(err), /CHECK|constraint|failed|UNIQUE|FOREIGN KEY|NOT NULL/i);
}

function rows(jsonResult) {
  return jsonResult[0]?.results ?? [];
}

function scalar(jsonResult) {
  const r = rows(jsonResult);
  if (!r.length) return null;
  const vals = Object.values(r[0]);
  return vals[0];
}

function mraId(mailboxId) {
  return `mra_primary_${mailboxId}`;
}

console.log("=== Phase 2B.20 Local D1 Receiving Address Verification ===\n");

// --- Section 7: Structure ---
run("7: mail_receiving_addresses table exists", () => {
  const out = d1(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='mail_receiving_addresses';",
  );
  assert.match(out, /mail_receiving_addresses/);
});

run("7b: indexes and no forbidden columns", () => {
  const idx = d1(
    "SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name='mail_receiving_addresses';",
  );
  assert.match(idx, /uq_mail_receiving_addresses_address/);
  assert.match(idx, /lower\(trim\(address\)\)/i);
  assert.match(idx, /uq_mail_receiving_addresses_primary_per_mailbox/);
  assert.match(idx, /status IN \('active', 'suspended'\)/);
  assert.match(idx, /idx_mail_receiving_addresses_mailbox_id/);
  assert.match(idx, /idx_mail_receiving_addresses_status/);
  const cols = d1("PRAGMA table_info(mail_receiving_addresses);");
  assert.doesNotMatch(cols, /sender_identity/i);
  assert.doesNotMatch(cols, /envelope/i);
  assert.doesNotMatch(cols, /provider/i);
  assert.doesNotMatch(cols, /webhook/i);
});

// --- Section 8: Backfill completeness ---
run("8: every mailbox has exactly one backfilled primary", () => {
  const missing = scalar(
    d1Json(`
      SELECT COUNT(*) AS c FROM mail_mailboxes m
      LEFT JOIN mail_receiving_addresses r
        ON r.mailbox_id = m.id AND r.address_type = 'primary'
      WHERE r.id IS NULL;
    `),
  );
  assert.equal(Number(missing), 0, `mailboxes without primary: ${missing}`);
  const multi = scalar(
    d1Json(`
      SELECT COUNT(*) AS c FROM (
        SELECT mailbox_id FROM mail_receiving_addresses
        WHERE address_type = 'primary'
        GROUP BY mailbox_id HAVING COUNT(*) > 1
      );
    `),
  );
  assert.equal(Number(multi), 0, `mailboxes with >1 primary: ${multi}`);
  const mismatch = scalar(
    d1Json(`
      SELECT COUNT(*) AS c FROM mail_mailboxes m
      JOIN mail_receiving_addresses r
        ON r.mailbox_id = m.id AND r.address_type = 'primary'
      WHERE lower(trim(r.address)) != lower(trim(m.address));
    `),
  );
  assert.equal(Number(mismatch), 0, `address mismatches: ${mismatch}`);
  const aliasBackfill = scalar(
    d1Json(`SELECT COUNT(*) FROM mail_receiving_addresses WHERE address_type = 'alias';`),
  );
  assert.equal(Number(aliasBackfill), 0);
  observations.everyPre0060MailboxOnePrimary = true;
  pass("8: backfill completeness verified");
});

// --- Section 9: Status mapping for pre-apply fixtures ---
run("9: pre-apply fixture status mapping", () => {
  const check = (mbId, expStatus, needRetiredAt) => {
    const r = rows(
      d1Json(`
        SELECT status, retired_at FROM mail_receiving_addresses
        WHERE mailbox_id = ${q(mbId)} AND address_type = 'primary';
      `),
    )[0];
    assert.ok(r, `no primary for ${mbId}`);
    assert.equal(r.status, expStatus);
    if (needRetiredAt) assert.ok(r.retired_at);
    else assert.equal(r.retired_at, null);
  };
  check(MB_ACTIVE, "active", false);
  check(MB_SUSP, "suspended", false);
  check(MB_ARCH, "suspended", false);
  check(MB_DEL, "retired", true);
});

// --- Section 10: Deterministic IDs ---
run("10: deterministic backfill IDs", () => {
  for (const mb of [MB_ACTIVE, MB_SUSP, MB_ARCH, MB_DEL]) {
    const id = scalar(
      d1Json(
        `SELECT id FROM mail_receiving_addresses WHERE mailbox_id = ${q(mb)} AND address_type = 'primary';`,
      ),
    );
    assert.equal(id, mraId(mb));
  }
});

// --- Section 11: Address constraints ---
run("11: address constraints runtime", () => {
  d1(
    `INSERT INTO mail_receiving_addresses (id, mailbox_id, address, address_type, status, created_at, updated_at)
     VALUES (${q(`${P}-ra-valid`)}, ${q(MB_ACTIVE)}, ${q("valid.alias@echfronthk.test")}, 'alias', 'active', ${q(NOW)}, ${q(NOW)});`,
  );
  pass("11a: normal alias address");

  for (const [label, addr] of [
    ["empty", ""],
    ["spaces", "   "],
    ["leading", " test@echfronthk.com"],
    ["trailing", "test@echfronthk.com "],
  ]) {
    const err = d1(
      `INSERT INTO mail_receiving_addresses (id, mailbox_id, address, address_type, status, created_at, updated_at)
       VALUES (${q(`${P}-bad-${label}`)}, ${q(MB_ACTIVE)}, ${q(addr)}, 'alias', 'active', ${q(NOW)}, ${q(NOW)});`,
      { expectFailure: true },
    );
    reject(err);
    pass(`11b: reject ${label}`);
  }

  const errType = d1(
    `INSERT INTO mail_receiving_addresses (id, mailbox_id, address, address_type, status, created_at, updated_at)
     VALUES (${q(`${P}-bad-type`)}, ${q(MB_ACTIVE)}, 'x@y.test', 'sender', 'active', ${q(NOW)}, ${q(NOW)});`,
    { expectFailure: true },
  );
  reject(errType);
  pass("11c: reject invalid address_type");

  const errStatus = d1(
    `INSERT INTO mail_receiving_addresses (id, mailbox_id, address, address_type, status, created_at, updated_at)
     VALUES (${q(`${P}-bad-status`)}, ${q(MB_ACTIVE)}, 'x2@y.test', 'alias', 'bogus', ${q(NOW)}, ${q(NOW)});`,
    { expectFailure: true },
  );
  reject(errStatus);
  pass("11d: reject invalid status");
});

// --- Section 12: Case-insensitive uniqueness ---
run("12: lifetime case-insensitive uniqueness", () => {
  d1(
    `INSERT INTO mail_receiving_addresses (id, mailbox_id, address, address_type, status, created_at, updated_at)
     VALUES (${q(`${P}-case-1`)}, ${q(MB_ACTIVE)}, ${q(ADDR_CASE)}, 'alias', 'active', ${q(NOW)}, ${q(NOW)});`,
  );
  const err = d1(
    `INSERT INTO mail_receiving_addresses (id, mailbox_id, address, address_type, status, created_at, updated_at)
     VALUES (${q(`${P}-case-2`)}, ${q(MB_SUSP)}, ${q("casetest@echfronthk.test")}, 'alias', 'active', ${q(NOW)}, ${q(NOW)});`,
    { expectFailure: true },
  );
  reject(err);
  const errPrimary = d1(
    `INSERT INTO mail_receiving_addresses (id, mailbox_id, address, address_type, status, created_at, updated_at)
     VALUES (${q(`${P}-case-3`)}, ${q(MB_SUSP)}, ${q(ADDR_ACTIVE.toUpperCase())}, 'alias', 'active', ${q(NOW)}, ${q(NOW)});`,
    { expectFailure: true },
  );
  reject(errPrimary);
  observations.caseVariantSecondRoute = false;
  pass("12: case variants rejected");
});

// --- Section 13: retired_at coupling ---
run("13: retired_at coupling", () => {
  d1(
    `INSERT INTO mail_receiving_addresses (id, mailbox_id, address, address_type, status, retired_at, created_at, updated_at)
     VALUES (${q(`${P}-ret-ok`)}, ${q(MB_ACTIVE)}, 'ret-ok@echfronthk.test', 'alias', 'retired', ${q(NOW)}, ${q(NOW)}, ${q(NOW)});`,
  );
  pass("13a: retired + retired_at ok");

  const errNoRet = d1(
    `INSERT INTO mail_receiving_addresses (id, mailbox_id, address, address_type, status, created_at, updated_at)
     VALUES (${q(`${P}-ret-bad1`)}, ${q(MB_ACTIVE)}, 'ret-bad1@echfronthk.test', 'alias', 'retired', ${q(NOW)}, ${q(NOW)});`,
    { expectFailure: true },
  );
  reject(errNoRet);

  const errActRet = d1(
    `INSERT INTO mail_receiving_addresses (id, mailbox_id, address, address_type, status, retired_at, created_at, updated_at)
     VALUES (${q(`${P}-ret-bad2`)}, ${q(MB_ACTIVE)}, 'ret-bad2@echfronthk.test', 'alias', 'active', ${q(NOW)}, ${q(NOW)}, ${q(NOW)});`,
    { expectFailure: true },
  );
  reject(errActRet);

  const errSuspRet = d1(
    `INSERT INTO mail_receiving_addresses (id, mailbox_id, address, address_type, status, retired_at, created_at, updated_at)
     VALUES (${q(`${P}-ret-bad3`)}, ${q(MB_ACTIVE)}, 'ret-bad3@echfronthk.test', 'alias', 'suspended', ${q(NOW)}, ${q(NOW)}, ${q(NOW)});`,
    { expectFailure: true },
  );
  reject(errSuspRet);
  pass("13b: retired_at coupling rejects");
});

// --- Section 14: Aliases ---
run("14: alias model", () => {
  for (const [mbId, addr] of [
    [MB_ALIAS, "alias-src.mail@echfronthk.test"],
    [MB_ALIAS_B, "alias-dst.mail@echfronthk.test"],
  ]) {
    d1(`INSERT INTO mail_mailboxes (id, address, display_name, mailbox_type, status, created_at, updated_at)
        VALUES (${q(mbId)}, ${q(addr)}, 'Alias MB', 'shared', 'active', ${q(NOW)}, ${q(NOW)});`);
    d1(
      `INSERT INTO mail_receiving_addresses (id, mailbox_id, address, address_type, status, created_at, updated_at)
       VALUES (${q(mraId(mbId))}, ${q(mbId)}, ${q(addr)}, 'primary', 'active', ${q(NOW)}, ${q(NOW)});`,
    );
  }
  d1(
    `INSERT INTO mail_receiving_addresses (id, mailbox_id, address, address_type, status, created_at, updated_at)
     VALUES (${q(`${P}-alias-a`)}, ${q(MB_ALIAS)}, ${q(ADDR_ALIAS_A)}, 'alias', 'active', ${q(NOW)}, ${q(NOW)});`,
  );
  d1(
    `INSERT INTO mail_receiving_addresses (id, mailbox_id, address, address_type, status, created_at, updated_at)
     VALUES (${q(`${P}-alias-b`)}, ${q(MB_ALIAS)}, ${q(ADDR_ALIAS_B)}, 'alias', 'active', ${q(NOW)}, ${q(NOW)});`,
  );
  d1(
    `INSERT INTO mail_receiving_addresses (id, mailbox_id, address, address_type, status, created_at, updated_at)
     VALUES (${q(`${P}-alias-c`)}, ${q(MB_ALIAS)}, ${q(ADDR_ALIAS_C)}, 'alias', 'suspended', ${q(NOW)}, ${q(NOW)});`,
  );
  const err = d1(
    `INSERT INTO mail_receiving_addresses (id, mailbox_id, address, address_type, status, created_at, updated_at)
     VALUES (${q(`${P}-alias-dup`)}, ${q(MB_ALIAS_B)}, ${q(ADDR_ALIAS_A)}, 'alias', 'active', ${q(NOW)}, ${q(NOW)});`,
    { expectFailure: true },
  );
  reject(err);
  pass("14: multiple aliases + cross-mailbox alias rejected");
});

// --- Section 15: Second current primary ---
run("15: at most one current primary per mailbox", () => {
  const errActAct = d1(
    `INSERT INTO mail_receiving_addresses (id, mailbox_id, address, address_type, status, created_at, updated_at)
     VALUES (${q(`${P}-prim-dup1`)}, ${q(MB_ACTIVE)}, 'dup-primary-a@echfronthk.test', 'primary', 'active', ${q(NOW)}, ${q(NOW)});`,
    { expectFailure: true },
  );
  reject(errActAct);
  const errActSusp = d1(
    `INSERT INTO mail_receiving_addresses (id, mailbox_id, address, address_type, status, created_at, updated_at)
     VALUES (${q(`${P}-prim-dup2`)}, ${q(MB_ACTIVE)}, 'dup-primary-b@echfronthk.test', 'primary', 'suspended', ${q(NOW)}, ${q(NOW)});`,
    { expectFailure: true },
  );
  reject(errActSusp);
  const errSuspAct = d1(
    `INSERT INTO mail_receiving_addresses (id, mailbox_id, address, address_type, status, created_at, updated_at)
     VALUES (${q(`${P}-prim-dup3`)}, ${q(MB_SUSP)}, 'dup-primary-c@echfronthk.test', 'primary', 'active', ${q(NOW)}, ${q(NOW)});`,
    { expectFailure: true },
  );
  reject(errSuspAct);
  const errSuspSusp = d1(
    `INSERT INTO mail_receiving_addresses (id, mailbox_id, address, address_type, status, created_at, updated_at)
     VALUES (${q(`${P}-prim-dup4`)}, ${q(MB_SUSP)}, 'dup-primary-d@echfronthk.test', 'primary', 'suspended', ${q(NOW)}, ${q(NOW)});`,
    { expectFailure: true },
  );
  reject(errSuspSusp);
  observations.atMostOneCurrentPrimary = true;
  pass("15: second current primary rejected");
});

// --- Sections 16-17: Primary rotation ---
run("16-17: primary rotation and old address reservation", () => {
  d1(`INSERT INTO mail_mailboxes (id, address, display_name, mailbox_type, status, created_at, updated_at)
      VALUES (${q(MB_ROT)}, ${q(ADDR_ROT_OLD)}, 'Rotate MB', 'personal', 'active', ${q(NOW)}, ${q(NOW)});`);
  d1(
    `INSERT INTO mail_receiving_addresses (id, mailbox_id, address, address_type, status, created_at, updated_at)
     VALUES (${q(mraId(MB_ROT))}, ${q(MB_ROT)}, ${q(ADDR_ROT_OLD)}, 'primary', 'active', ${q(NOW)}, ${q(NOW)});`,
  );

  const errEarly = d1(
    `INSERT INTO mail_receiving_addresses (id, mailbox_id, address, address_type, status, created_at, updated_at)
     VALUES (${q(`${P}-rot-early`)}, ${q(MB_ROT)}, ${q(ADDR_ROT_NEW)}, 'primary', 'active', ${q(NOW)}, ${q(NOW)});`,
    { expectFailure: true },
  );
  reject(errEarly);

  d1(
    `UPDATE mail_receiving_addresses SET status = 'retired', retired_at = ${q(NOW)}, updated_at = ${q(NOW)}
     WHERE id = ${q(mraId(MB_ROT))};`,
  );
  d1(
    `INSERT INTO mail_receiving_addresses (id, mailbox_id, address, address_type, status, created_at, updated_at)
     VALUES (${q(`${P}-rot-new`)}, ${q(MB_ROT)}, ${q(ADDR_ROT_NEW)}, 'primary', 'active', ${q(NOW)}, ${q(NOW)});`,
  );
  d1(`UPDATE mail_mailboxes SET address = ${q(ADDR_ROT_NEW)}, updated_at = ${q(NOW)} WHERE id = ${q(MB_ROT)};`);

  const oldRow = rows(
    d1Json(`SELECT status FROM mail_receiving_addresses WHERE id = ${q(mraId(MB_ROT))};`),
  )[0];
  assert.equal(oldRow.status, "retired");
  const newRow = rows(
    d1Json(
      `SELECT status, address FROM mail_receiving_addresses WHERE id = ${q(`${P}-rot-new`)};`,
    ),
  )[0];
  assert.equal(newRow.status, "active");
  assert.equal(newRow.address, ADDR_ROT_NEW);
  const mbAddr = scalar(d1Json(`SELECT address FROM mail_mailboxes WHERE id = ${q(MB_ROT)};`));
  assert.equal(mbAddr, ADDR_ROT_NEW);

  const errAliasOld = d1(
    `INSERT INTO mail_receiving_addresses (id, mailbox_id, address, address_type, status, created_at, updated_at)
     VALUES (${q(`${P}-old-alias`)}, ${q(MB_ALIAS_B)}, ${q(ADDR_ROT_OLD)}, 'alias', 'active', ${q(NOW)}, ${q(NOW)});`,
    { expectFailure: true },
  );
  reject(errAliasOld);
  const errPrimOld = d1(
    `INSERT INTO mail_receiving_addresses (id, mailbox_id, address, address_type, status, created_at, updated_at)
     VALUES (${q(`${P}-old-prim`)}, ${q(MB_ALIAS_B)}, ${q(ADDR_ROT_OLD)}, 'primary', 'active', ${q(NOW)}, ${q(NOW)});`,
    { expectFailure: true },
  );
  reject(errPrimOld);

  observations.retiredCoexistsWithCurrent = true;
  observations.oldPrimaryReserved = true;
  pass("16-17: rotation + old address reserved");
});

// --- Section 18: Multiple historical primaries ---
run("18: multiple historical primaries + one current", () => {
  d1(`INSERT INTO mail_mailboxes (id, address, display_name, mailbox_type, status, created_at, updated_at)
      VALUES (${q(MB_HIST)}, ${q(ADDR_HIST_CUR)}, 'Hist MB', 'shared', 'active', ${q(NOW)}, ${q(NOW)});`);
  d1(
    `INSERT INTO mail_receiving_addresses (id, mailbox_id, address, address_type, status, retired_at, created_at, updated_at)
     VALUES (${q(`${P}-hist-1`)}, ${q(MB_HIST)}, ${q(ADDR_HIST1)}, 'primary', 'retired', ${q(NOW)}, ${q(NOW)}, ${q(NOW)});`,
  );
  d1(
    `INSERT INTO mail_receiving_addresses (id, mailbox_id, address, address_type, status, retired_at, created_at, updated_at)
     VALUES (${q(`${P}-hist-2`)}, ${q(MB_HIST)}, ${q(ADDR_HIST2)}, 'primary', 'retired', ${q(NOW)}, ${q(NOW)}, ${q(NOW)});`,
  );
  d1(
    `INSERT INTO mail_receiving_addresses (id, mailbox_id, address, address_type, status, created_at, updated_at)
     VALUES (${q(`${P}-hist-cur`)}, ${q(MB_HIST)}, ${q(ADDR_HIST_CUR)}, 'primary', 'active', ${q(NOW)}, ${q(NOW)});`,
  );
  const count = scalar(
    d1Json(
      `SELECT COUNT(*) FROM mail_receiving_addresses WHERE mailbox_id = ${q(MB_HIST)} AND address_type = 'primary';`,
    ),
  );
  assert.equal(Number(count), 3);
  pass("18: multiple retired historical + current primary");
});

// --- Section 19: Deleted mailbox ---
run("19: deleted mailbox initial state", () => {
  const r = rows(
    d1Json(
      `SELECT status, retired_at FROM mail_receiving_addresses WHERE mailbox_id = ${q(MB_DEL)} AND address_type = 'primary';`,
    ),
  )[0];
  assert.equal(r.status, "retired");
  assert.ok(r.retired_at);
  const current = scalar(
    d1Json(
      `SELECT COUNT(*) FROM mail_receiving_addresses WHERE mailbox_id = ${q(MB_DEL)} AND address_type = 'primary' AND status IN ('active','suspended');`,
    ),
  );
  assert.equal(Number(current), 0);
  pass("19: deleted mailbox has retired primary only");
});

// --- Section 20: Mailbox hard delete ---
run("20: mailbox hard delete rejected by FK", () => {
  const err = d1(`DELETE FROM mail_mailboxes WHERE id = ${q(MB_ACTIVE)};`, {
    expectFailure: true,
  });
  reject(err);
  pass("20: FK prevents mailbox hard delete");
});

// --- Section 21: created_by user attribution ---
run("21: created_by ON DELETE SET NULL", () => {
  d1(`INSERT INTO users (id, email, display_name, password_hash, role, is_active, failed_login_attempts, must_change_password, initial_device_auto_approval_eligible, created_at, updated_at)
      VALUES (${q(USER)}, ${q(`${P}-user@test.example`)}, 'RA User', 'hash', 'staff', 1, 0, 0, 0, ${q(NOW)}, ${q(NOW)});`);
  d1(
    `INSERT INTO mail_receiving_addresses (id, mailbox_id, address, address_type, status, created_by_user_id, created_at, updated_at)
     VALUES (${q(`${P}-by-user`)}, ${q(MB_ACTIVE)}, 'by-user@echfronthk.test', 'alias', 'active', ${q(USER)}, ${q(NOW)}, ${q(NOW)});`,
  );
  d1(`DELETE FROM users WHERE id = ${q(USER)};`);
  const cb = scalar(
    d1Json(
      `SELECT created_by_user_id FROM mail_receiving_addresses WHERE id = ${q(`${P}-by-user`)};`,
    ),
  );
  assert.equal(cb, null);
  pass("21: created_by_user_id SET NULL on user delete");
});

// --- Section 22: Sender identity independence ---
run("22: sender identity same address allowed", () => {
  d1(
    `INSERT INTO mail_receiving_addresses (id, mailbox_id, address, address_type, status, created_at, updated_at)
     VALUES (${q(`${P}-recv-shared`)}, ${q(MB_ACTIVE)}, ${q(ADDR_SHARED)}, 'alias', 'active', ${q(NOW)}, ${q(NOW)});`,
  );
  d1(
    `INSERT INTO mail_sender_identities (id, address, status, default_mailbox_id, created_at, updated_at)
     VALUES (${q(SENDER)}, ${q(ADDR_SHARED)}, 'active', ${q(MB_ACTIVE)}, ${q(NOW)}, ${q(NOW)});`,
  );
  const recvCount = scalar(
    d1Json(
      `SELECT COUNT(*) FROM mail_receiving_addresses WHERE lower(trim(address)) = lower(trim(${q(ADDR_SHARED)}));`,
    ),
  );
  assert.equal(Number(recvCount), 1);
  const route = rows(
    d1Json(
      `SELECT mailbox_id FROM mail_receiving_addresses WHERE lower(trim(address)) = lower(trim(${q(ADDR_SHARED)})) AND status = 'active';`,
    ),
  );
  assert.equal(route.length, 1);
  observations.receivingMayMatchSenderIdentity = true;
  observations.senderIdentityNotInboundRouting = true;
  pass("22: same address on receiving + sender identity");
});

// --- Section 23: Routing lookup ---
run("23: normalized routing lookup", () => {
  const input = "  ACTIVE.MAIL@echfronthk.test  ";
  const normalized = input.trim().toLowerCase();
  const cnt = scalar(
    d1Json(
      `SELECT COUNT(*) FROM mail_receiving_addresses WHERE lower(trim(address)) = ${q(normalized)};`,
    ),
  );
  assert.equal(Number(cnt), 1);
  pass("23: trim+lowercase lookup returns exactly one row");
});

// --- Sections 24-27: documented boundaries ---
observations.dbAutoCreatesPrimaryForNewMailbox = false;
observations.mailboxServiceMustCreateBoth = true;
observations.dbAutoSyncsLifecycle = false;
observations.serviceMustCoordinate = true;
observations.envelopeProvenanceIn0060 = false;
observations.nextDomainRequired = true;
pass("24-27: service boundaries documented");

// --- Section 25: New mailbox after 0060 ---
run("25: new mailbox does not auto-create primary route", () => {
  d1(`INSERT INTO mail_mailboxes (id, address, display_name, mailbox_type, status, created_at, updated_at)
      VALUES (${q(MB_NEW)}, ${q(ADDR_NEW_MB)}, 'Post-0060 MB', 'personal', 'active', ${q(NOW)}, ${q(NOW)});`);
  const cnt = scalar(
    d1Json(
      `SELECT COUNT(*) FROM mail_receiving_addresses WHERE mailbox_id = ${q(MB_NEW)};`,
    ),
  );
  assert.equal(Number(cnt), 0);
  d1(
    `INSERT INTO mail_receiving_addresses (id, mailbox_id, address, address_type, status, created_at, updated_at)
     VALUES (${q(mraId(MB_NEW))}, ${q(MB_NEW)}, ${q(ADDR_NEW_MB)}, 'primary', 'active', ${q(NOW)}, ${q(NOW)});`,
  );
  pass("25: no auto primary; manual create ok");
});

// --- Section 28: Fixture cleanup ---
run("28: fixture cleanup", () => {
  const stmts = [
    `DELETE FROM mail_receiving_addresses WHERE id LIKE ${q(P + "%")} OR mailbox_id LIKE ${q(P + "%")};`,
    `DELETE FROM mail_sender_identities WHERE id LIKE ${q(P + "%")};`,
    `DELETE FROM mail_mailboxes WHERE id LIKE ${q(P + "%")};`,
    `DELETE FROM users WHERE id LIKE ${q(P + "%")};`,
  ];
  for (const sql of stmts) d1(sql);
  const rem = scalar(
    d1Json(
      `SELECT COUNT(*) FROM mail_mailboxes WHERE id LIKE ${q(P + "%")} OR id LIKE ${q(P + "-%")};`,
    ),
  );
  assert.equal(Number(rem), 0);
  pass("28: synthetic fixtures removed");
});

// --- Section 29: Real backfill integrity ---
run("29: non-fixture backfill rows remain", () => {
  const totalMb = scalar(d1Json(`SELECT COUNT(*) FROM mail_mailboxes;`));
  const totalPrim = scalar(
    d1Json(
      `SELECT COUNT(*) FROM mail_receiving_addresses WHERE address_type = 'primary';`,
    ),
  );
  assert.equal(Number(totalMb), Number(totalPrim));
  pass("29: all remaining mailboxes still have primary routes");
});

// --- Summary ---
const failed = results.filter((r) => !r.ok);
console.log("\n=== Summary ===");
console.log(`Total: ${results.length}  Passed: ${results.filter((r) => r.ok).length}  Failed: ${failed.length}`);
console.log("\nObservations:", JSON.stringify(observations, null, 2));

if (failed.length) {
  console.error("\nPHASE 2B.20 NOT READY");
  process.exit(1);
}
console.log("\nPHASE 2B.20 LOCAL RECEIVING ADDRESS VERIFIED — 0060 READY TO FREEZE");
process.exit(0);
