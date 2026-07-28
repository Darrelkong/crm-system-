import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  decideBackfillCli,
  PRODUCTION_BACKFILL_CONFIRM,
  REQUIRED_DATABASE_NAME,
} from "@/lib/customers/contact-identifiers-backfill-cli";

describe("backfill CLI argument safety (no D1)", () => {
  it("default (no args) is local dry-run with 0 writes", () => {
    const d = decideBackfillCli([]);
    assert.equal(d.ok, true);
    if (!d.ok) return;
    assert.equal(d.target, "local");
    assert.equal(d.mode, "dry-run");
    assert.equal(d.database, REQUIRED_DATABASE_NAME);
    assert.equal(d.rowsWritten, 0);
  });

  it("remote dry-run allowed with --remote --database=crm-db", () => {
    const d = decideBackfillCli([
      "--remote",
      `--database=${REQUIRED_DATABASE_NAME}`,
    ]);
    assert.equal(d.ok, true);
    if (!d.ok) return;
    assert.equal(d.target, "remote");
    assert.equal(d.mode, "dry-run");
    assert.equal(d.rowsWritten, 0);
  });

  it("remote without database fail-closed", () => {
    const d = decideBackfillCli(["--remote"]);
    assert.equal(d.ok, false);
    if (d.ok) return;
    assert.equal(d.code, "DATABASE_REQUIRED");
    assert.equal(d.rowsWritten, 0);
  });

  it("remote apply missing confirm fail-closed", () => {
    const d = decideBackfillCli([
      "--remote",
      "--apply",
      `--database=${REQUIRED_DATABASE_NAME}`,
    ]);
    assert.equal(d.ok, false);
    if (d.ok) return;
    assert.equal(d.code, "CONFIRM_REQUIRED");
    assert.equal(d.rowsWritten, 0);
  });

  it("remote apply wrong database fail-closed", () => {
    const d = decideBackfillCli([
      "--remote",
      "--apply",
      "--database=other-db",
      `--confirm=${PRODUCTION_BACKFILL_CONFIRM}`,
    ]);
    assert.equal(d.ok, false);
    if (d.ok) return;
    assert.equal(d.code, "DATABASE_NOT_ALLOWED");
    assert.equal(d.rowsWritten, 0);
  });

  it("bare --apply without --local fail-closed", () => {
    const d = decideBackfillCli(["--apply"]);
    assert.equal(d.ok, false);
    if (d.ok) return;
    assert.equal(d.code, "APPLY_REQUIRES_TARGET");
    assert.equal(d.rowsWritten, 0);
  });

  it("remote apply with full confirm enters apply decision", () => {
    const d = decideBackfillCli([
      "--remote",
      "--apply",
      `--database=${REQUIRED_DATABASE_NAME}`,
      `--confirm=${PRODUCTION_BACKFILL_CONFIRM}`,
    ]);
    assert.equal(d.ok, true);
    if (!d.ok) return;
    assert.equal(d.target, "remote");
    assert.equal(d.mode, "apply");
    assert.equal(d.rowsWritten, 0);
  });

  it("local apply requires --local --apply", () => {
    const d = decideBackfillCli(["--local", "--apply"]);
    assert.equal(d.ok, true);
    if (!d.ok) return;
    assert.equal(d.target, "local");
    assert.equal(d.mode, "apply");
  });

  it("--force is rejected", () => {
    const d = decideBackfillCli(["--local", "--apply", "--force"]);
    assert.equal(d.ok, false);
    if (d.ok) return;
    assert.equal(d.code, "FORCE_FORBIDDEN");
    assert.equal(d.rowsWritten, 0);
  });

  it("wrong confirm token fail-closed", () => {
    const d = decideBackfillCli([
      "--remote",
      "--apply",
      `--database=${REQUIRED_DATABASE_NAME}`,
      "--confirm=YES",
    ]);
    assert.equal(d.ok, false);
    if (d.ok) return;
    assert.equal(d.code, "CONFIRM_REQUIRED");
  });
});
