import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import {
  classifyContactIdentifierUniqueConstraintError,
  isGlobalContactIdentifierUniqueConstraintError,
  isPerCustomerIdentifierUniqueConstraintError,
} from "@/lib/customers/contact-identifiers";
import {
  resolveIdentifierConstraintAsDuplicates,
} from "@/lib/customers/contact-identifier-conflict";

describe("identifier unique constraint classification", () => {
  it("0041 per-customer unique is NOT treated as global duplicate mapping", () => {
    const err = new Error(
      "UNIQUE constraint failed: customer_contact_identifiers.customer_id, customer_contact_identifiers.contact_type, customer_contact_identifiers.normalized_value",
    );
    assert.equal(classifyContactIdentifierUniqueConstraintError(err), "per_customer");
    assert.equal(isPerCustomerIdentifierUniqueConstraintError(err), true);
    assert.equal(isGlobalContactIdentifierUniqueConstraintError(err), false);
  });

  it("per-customer index name is classified as per_customer", () => {
    const err = new Error(
      "UNIQUE constraint failed: uq_customer_contact_identifiers_customer_type_value",
    );
    assert.equal(classifyContactIdentifierUniqueConstraintError(err), "per_customer");
  });

  it("future global unique is classified as global", () => {
    const err = new Error(
      "UNIQUE constraint failed: customer_contact_identifiers.contact_type, customer_contact_identifiers.normalized_value",
    );
    assert.equal(classifyContactIdentifierUniqueConstraintError(err), "global");
    assert.equal(isGlobalContactIdentifierUniqueConstraintError(err), true);
  });

  it("resolveIdentifierConstraintAsDuplicates ignores per-customer unique", async () => {
    const mapped = await resolveIdentifierConstraintAsDuplicates(
      new Error(
        "UNIQUE constraint failed: customer_contact_identifiers.customer_id, customer_contact_identifiers.contact_type, customer_contact_identifiers.normalized_value",
      ),
      { phoneCountryCode: "+86", phone: "13800138000" },
      { id: "u1", role: "admin" } as never,
    );
    assert.equal(mapped, null);
  });

  it("non-unique errors are ignored", async () => {
    const mapped = await resolveIdentifierConstraintAsDuplicates(
      new Error("boom"),
      { phone: "13800138000", phoneCountryCode: "+86" },
      { id: "u1", role: "admin" } as never,
    );
    assert.equal(mapped, null);
  });
});

describe("health / backup identifiers wiring (source)", () => {
  it("health gates identifiers behind 0041 migration (non-prod)", () => {
    const source = readFileSync("src/app/api/health/route.ts", "utf8");
    assert.match(source, /customer_contact_identifiers/);
    assert.match(source, /0041_create_customer_contact_identifiers/);
    assert.match(source, /MIGRATION_GATED_TABLES/);
  });

  it("backup allowlist includes customer_contact_identifiers", () => {
    const constants = readFileSync("src/lib/backup/constants.ts", "utf8");
    const exportData = readFileSync("src/lib/backup/export-data.ts", "utf8");
    assert.match(constants, /customer_contact_identifiers/);
    assert.match(exportData, /customerContactIdentifiers/);
    assert.match(exportData, /customer_contact_identifiers:/);
  });
});
