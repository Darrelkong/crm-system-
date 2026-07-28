import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

describe("Phase 2A write-path identifier wiring (source)", () => {
  it("Create batches customer + assignee + identifiers", () => {
    const source = readFileSync("src/app/api/customers/route.ts", "utf8");
    assert.match(source, /buildReplaceCustomerIdentifierStatements/);
    assert.match(source, /insertCustomerStmt/);
    assert.match(source, /insertPrimaryAssigneeStmt/);
    assert.match(source, /\.\.\.identifierSync\.statements/);
    assert.match(source, /resolveIdentifierConstraintAsDuplicates/);
    assert.match(source, /duplicateCustomerConflictResponse/);
  });

  it("Edit batches customer update + replace identifiers", () => {
    const source = readFileSync("src/app/api/customers/[id]/route.ts", "utf8");
    assert.match(source, /loadSecondaryContactsForCustomer/);
    assert.match(source, /buildReplaceCustomerIdentifierStatements/);
    assert.match(source, /persistCustomerAndIdentifiers/);
    assert.match(source, /\.\.\.identifierSync\.statements/);
    assert.match(source, /excludeId|,\s*id\s*\)/);
  });

  it("Import commit batches identifiers with create", () => {
    const source = readFileSync(
      "src/lib/import/customers/commit.ts",
      "utf8",
    );
    assert.match(source, /buildReplaceCustomerIdentifierStatements/);
    assert.match(source, /\.\.\.identifierSync\.statements/);
    assert.match(source, /resolveIdentifierConstraintAsDuplicates/);
  });

  it("Quick-entry prepare includes identifier statements", () => {
    const source = readFileSync(
      "src/lib/public-pool/quick-entry-customer-service.ts",
      "utf8",
    );
    assert.match(source, /buildReplaceCustomerIdentifierStatements/);
    assert.match(source, /\.\.\.identifierSync\.statements/);
    assert.match(source, /isGlobalContactIdentifierUniqueConstraintError/);
  });

  it("documents official deploy order forbidding backfill-before-deploy", () => {
    const source = readFileSync(
      "scripts/backfill-customer-contact-identifiers.ts",
      "utf8",
    );
    assert.match(source, /0041 → backfill → deploy|never[\s\S]*backfill → deploy/i);
    assert.match(source, /push \/ deploy Phase 2A/);
    assert.match(source, /PRODUCTION_BACKFILL_CONFIRM|BACKFILL_CUSTOMER_CONTACT_IDENTIFIERS_PRODUCTION/);
  });

  it("does not change Phase 1 normalization module", () => {
    const source = readFileSync(
      "src/lib/customers/contact-normalization.ts",
      "utf8",
    );
    assert.match(source, /normalizeCustomerPhone/);
    assert.match(source, /normalizeCustomerWechat/);
    assert.match(source, /normalizeCustomerEmail/);
  });
});
