import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildCustomerContactIdentifiers,
  buildReplaceCustomerIdentifierStatements,
  isContactIdentifierUniqueConstraintError,
} from "@/lib/customers/contact-identifiers";
import {
  diffIdentifierSets,
  findCrossCustomerIdentifierConflicts,
  maskNormalizedIdentifier,
} from "@/lib/customers/contact-identifiers-backfill";
import {
  duplicateCustomerConflictResponse,
  resolveIdentifierConstraintAsDuplicates,
} from "@/lib/customers/contact-identifier-conflict";
import type { DuplicateMatch } from "@/lib/customers/duplicate-check";

describe("buildCustomerContactIdentifiers", () => {
  it("normalizes primary phone / wechat / email", () => {
    const rows = buildCustomerContactIdentifiers({
      phoneCountryCode: "+86",
      phone: "138-0013-8000",
      wechatId: "Wx_User",
      email: "A@Example.COM",
    });
    assert.deepEqual(
      rows.map((r) => `${r.contactType}:${r.normalizedValue}`).sort(),
      [
        "email:a@example.com",
        "phone:+8613800138000",
        "wechat_id:wx_user",
      ],
    );
  });

  it("dedupes identical primary and secondary values", () => {
    const rows = buildCustomerContactIdentifiers({
      phoneCountryCode: "+86",
      phone: "13800138000",
      wechatId: "same_wx",
      email: "same@example.com",
      secondaryContacts: [
        {
          phone: "138-0013-8000",
          wechatId: "SAME_WX",
          email: "Same@Example.com",
        },
      ],
    });
    assert.equal(rows.length, 3);
  });

  it("keeps different contact types independent", () => {
    const rows = buildCustomerContactIdentifiers({
      phone: null,
      wechatId: "abc",
      email: "abc@example.com",
    });
    assert.equal(rows.length, 2);
    assert.ok(rows.some((r) => r.contactType === "wechat_id"));
    assert.ok(rows.some((r) => r.contactType === "email"));
  });

  it("skips empty and un-normalizable values", () => {
    const rows = buildCustomerContactIdentifiers({
      phoneCountryCode: null,
      phone: "13800138000",
      wechatId: "   ",
      email: null,
      secondaryContacts: [{ phone: "", wechatId: null, email: "  " }],
    });
    assert.equal(rows.length, 0);
  });

  it("still builds identifiers for archived / public_pool customers (caller status-agnostic)", () => {
    const rows = buildCustomerContactIdentifiers({
      phoneCountryCode: "+86",
      phone: "13900001111",
      wechatId: null,
      email: null,
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.contactType, "phone");
  });

  it("secondary phone inherits parent country code", () => {
    const rows = buildCustomerContactIdentifiers({
      phoneCountryCode: "+86",
      phone: null,
      secondaryContacts: [{ phone: "13900002222" }],
    });
    assert.equal(rows[0]?.normalizedValue, "+8613900002222");
  });
});

describe("buildReplaceCustomerIdentifierStatements", () => {
  it("returns DELETE then INSERT statements for one customer", () => {
    const calls: string[] = [];
    const fakeDb = {
      delete() {
        calls.push("delete");
        return {
          where() {
            return { kind: "delete" };
          },
        };
      },
      insert() {
        calls.push("insert");
        return {
          values() {
            return { kind: "insert" };
          },
        };
      },
    };

    const result = buildReplaceCustomerIdentifierStatements(fakeDb as never, {
      customerId: "cust-1",
      phoneCountryCode: "+86",
      phone: "13800138000",
      wechatId: "wx1",
      email: null,
      secondaryContacts: [],
      now: "2026-07-29T00:00:00.000Z",
    });

    assert.equal(calls[0], "delete");
    assert.equal(result.statements.length, 1 + result.identifiers.length);
    assert.equal(result.identifiers.length, 2);
  });
});

describe("isContactIdentifierUniqueConstraintError / global gate", () => {
  it("detects future global identifier unique failures only", () => {
    assert.equal(
      isContactIdentifierUniqueConstraintError(
        new Error(
          "UNIQUE constraint failed: customer_contact_identifiers.contact_type, customer_contact_identifiers.normalized_value",
        ),
      ),
      true,
    );
    assert.equal(
      isContactIdentifierUniqueConstraintError(
        new Error(
          "UNIQUE constraint failed: customer_contact_identifiers.customer_id, customer_contact_identifiers.contact_type, customer_contact_identifiers.normalized_value",
        ),
      ),
      false,
    );
    assert.equal(
      isContactIdentifierUniqueConstraintError(new Error("no such table")),
      false,
    );
  });
});

describe("identifier conflict helpers", () => {
  it("finds cross-customer conflicts without exposing full PII", () => {
    const conflicts = findCrossCustomerIdentifierConflicts([
      {
        customerId: "a",
        customerCode: "EF1",
        status: "active",
        identifiers: [
          { contactType: "phone", normalizedValue: "+8613800138000" },
        ],
        unnormalizableCount: 0,
      },
      {
        customerId: "b",
        customerCode: "EF2",
        status: "public_pool",
        identifiers: [
          { contactType: "phone", normalizedValue: "+8613800138000" },
        ],
        unnormalizableCount: 0,
      },
    ]);
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0]?.customerIds.length, 2);
    assert.equal(conflicts[0]?.valueHash.length, 12);
    assert.ok(!conflicts[0]?.maskedValue.includes("13800138000"));
    assert.ok(conflicts[0]?.maskedValue.includes("****"));
  });

  it("diffIdentifierSets reports insert/delete/keep", () => {
    const diff = diffIdentifierSets(
      [{ contactType: "phone", normalizedValue: "+86111" }],
      [
        { contactType: "phone", normalizedValue: "+86111" },
        { contactType: "email", normalizedValue: "a@b.c" },
      ],
    );
    assert.deepEqual(diff, { insert: 1, delete: 0, keep: 1 });
  });

  it("maskNormalizedIdentifier never returns full email/phone", () => {
    assert.ok(
      !maskNormalizedIdentifier("email", "secret@example.com").includes(
        "secret@",
      ),
    );
    assert.ok(
      !maskNormalizedIdentifier("phone", "+8613800138000").includes(
        "13800138000",
      ),
    );
  });
});

describe("future identifier constraint → Phase 1 409 mapping", () => {
  it("duplicateCustomerConflictResponse matches Phase 1 shape", () => {
    const duplicates: DuplicateMatch[] = [
      {
        field: "phone",
        matchedField: "phone",
        customer: { isMasked: true },
      },
    ];
    const response = duplicateCustomerConflictResponse(duplicates);
    assert.equal(response.status, 409);
  });

  it("resolveIdentifierConstraintAsDuplicates ignores non-constraint errors", async () => {
    const mapped = await resolveIdentifierConstraintAsDuplicates(
      new Error("boom"),
      { phone: "13800138000", phoneCountryCode: "+86" },
      { id: "u1", role: "admin" } as never,
    );
    assert.equal(mapped, null);
  });
});
