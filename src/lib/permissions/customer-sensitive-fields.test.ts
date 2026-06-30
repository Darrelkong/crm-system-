import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Customer } from "../../../drizzle/schema/customers";
import type { User } from "../../../drizzle/schema/users";
import { buildCustomerUpdatePayload } from "@/lib/customers/field-change-log";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import {
  assertCanEditCustomer,
  assertStaffCannotModifySensitiveCustomerFields,
  PermissionError,
  staffSensitiveCustomerFieldsChanged,
} from "./customers";

const staffA = {
  id: SEED_IDS.staffA,
  role: "staff",
} as User;

const staffB = {
  id: SEED_IDS.staffB,
  role: "staff",
} as User;

const admin = {
  id: SEED_IDS.admin,
  role: "admin",
} as User;

function makeActiveCustomer(
  overrides: Partial<Customer> & Pick<Customer, "id" | "customerName">,
): Customer {
  const now = "2026-06-28T12:00:00.000Z";
  return {
    customerCode: "EF-100",
    customerType: "individual",
    phoneCountryCode: "+86",
    phone: "13800000001",
    wechatId: "wx_staff",
    email: "client@example.com",
    source: "referral",
    sourceRemark: "介紹備註",
    requestedProjectName: "項目 A",
    notes: "首次溝通備註內容",
    salesStage: "new_lead",
    status: "active",
    ownerId: SEED_IDS.staffA,
    releaserUserId: null,
    isPinned: 0,
    pinnedAt: null,
    lastFollowUpAt: null,
    lastValidFollowUpAt: null,
    nextFollowUpAt: null,
    createdBy: SEED_IDS.staffA,
    updatedBy: SEED_IDS.staffA,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    deletedBy: null,
    deletedReason: null,
    poolEnteredAt: null,
    poolReason: null,
    releasedBy: null,
    previousOwnerId: null,
    claimedBy: null,
    claimedAt: null,
    poolLeftAt: null,
    ...overrides,
  } as Customer;
}

function payloadFromCustomer(
  customer: Customer,
  overrides: Partial<Parameters<typeof buildCustomerUpdatePayload>[0]> = {},
) {
  return buildCustomerUpdatePayload({
    customerName: customer.customerName,
    customerType: customer.customerType,
    phoneCountryCode: customer.phoneCountryCode,
    phone: customer.phone,
    wechatId: customer.wechatId,
    email: customer.email,
    source: customer.source,
    sourceRemark: customer.sourceRemark,
    requestedProjectName: customer.requestedProjectName,
    notes: customer.notes,
    salesStage: customer.salesStage,
    status: customer.status,
    ...overrides,
  });
}

function assertPermissionLocked(fn: () => void) {
  assert.throws(fn, (err: unknown) => {
    assert.ok(err instanceof PermissionError);
    assert.equal(err.status, 403);
    assert.equal(
      err.auditAction,
      "permission.denied.customer_sensitive_fields_locked",
    );
    assert.equal(err.message, "敏感資料不可由員工修改");
    return true;
  });
}

describe("assertStaffCannotModifySensitiveCustomerFields", () => {
  const existing = makeActiveCustomer({
    id: "customer-sensitive",
    customerName: "張三",
  });

  const sensitiveFieldChanges: Array<{
    field: string;
    override: Partial<Parameters<typeof buildCustomerUpdatePayload>[0]>;
  }> = [
    { field: "customerName", override: { customerName: "李四" } },
    { field: "customerType", override: { customerType: "enterprise" } },
    { field: "source", override: { source: "other" } },
    {
      field: "requestedProjectName",
      override: { requestedProjectName: "項目 B" },
    },
    { field: "phoneCountryCode", override: { phoneCountryCode: "+852" } },
    { field: "phone", override: { phone: "91234567" } },
    { field: "wechatId", override: { wechatId: "wx_new" } },
    { field: "email", override: { email: "new@example.com" } },
    { field: "notes", override: { notes: "新的首次溝通備註內容" } },
  ];

  for (const { field, override } of sensitiveFieldChanges) {
    it(`blocks staff when ${field} changes`, () => {
      const payload = payloadFromCustomer(existing, override);
      assert.equal(staffSensitiveCustomerFieldsChanged(existing, payload), true);
      assertPermissionLocked(() =>
        assertStaffCannotModifySensitiveCustomerFields(staffA, existing, payload),
      );
    });
  }

  it("allows staff to change salesStage only", () => {
    const payload = payloadFromCustomer(existing, {
      salesStage: "qualified",
    });
    assert.equal(staffSensitiveCustomerFieldsChanged(existing, payload), false);
    assert.doesNotThrow(() =>
      assertStaffCannotModifySensitiveCustomerFields(staffA, existing, payload),
    );
  });

  it("allows staff to change sourceRemark only", () => {
    const payload = payloadFromCustomer(existing, {
      sourceRemark: "更新後的來源備註",
    });
    assert.equal(staffSensitiveCustomerFieldsChanged(existing, payload), false);
    assert.doesNotThrow(() =>
      assertStaffCannotModifySensitiveCustomerFields(staffA, existing, payload),
    );
  });

  it("allows staff full form when sensitive values are unchanged", () => {
    const payload = payloadFromCustomer(existing, {
      salesStage: "qualified",
      sourceRemark: "更新後的來源備註",
    });
    assert.equal(staffSensitiveCustomerFieldsChanged(existing, payload), false);
    assert.doesNotThrow(() =>
      assertStaffCannotModifySensitiveCustomerFields(staffA, existing, payload),
    );
  });

  it("treats email as unchanged when normalized values match", () => {
    const mixedCaseCustomer = makeActiveCustomer({
      id: "customer-email-case",
      customerName: "Email Case",
      email: "Test@Email.com",
    });
    const payload = payloadFromCustomer(mixedCaseCustomer, {
      email: "test@email.com",
      salesStage: "qualified",
    });
    assert.equal(
      staffSensitiveCustomerFieldsChanged(mixedCaseCustomer, payload),
      false,
    );
    assert.doesNotThrow(() =>
      assertStaffCannotModifySensitiveCustomerFields(
        staffA,
        mixedCaseCustomer,
        payload,
      ),
    );
  });

  it("allows admin to change sensitive fields", () => {
    const payload = payloadFromCustomer(existing, {
      customerName: "管理員修改",
      phone: "13900000099",
    });
    assert.equal(staffSensitiveCustomerFieldsChanged(existing, payload), true);
    assert.doesNotThrow(() =>
      assertStaffCannotModifySensitiveCustomerFields(admin, existing, payload),
    );
  });

  it("blocks public pool claimed owner staff from changing sensitive fields", () => {
    const claimedCustomer = makeActiveCustomer({
      id: "customer-claimed",
      customerName: "領取客戶",
      ownerId: SEED_IDS.staffB,
      claimedBy: SEED_IDS.staffB,
      claimedAt: "2026-06-28T13:00:00.000Z",
      previousOwnerId: SEED_IDS.staffA,
      status: "active",
    });
    const payload = payloadFromCustomer(claimedCustomer, {
      phone: "13800000099",
    });
    assertPermissionLocked(() =>
      assertStaffCannotModifySensitiveCustomerFields(
        staffB,
        claimedCustomer,
        payload,
      ),
    );
  });

  it("does not affect collaborator edit permission (still cannot edit)", () => {
    const customer = makeActiveCustomer({
      id: "customer-collab",
      customerName: "共同負責客戶",
    });
    assert.throws(
      () => assertCanEditCustomer(staffB, customer),
      (err: unknown) => {
        assert.ok(err instanceof PermissionError);
        assert.equal(err.auditAction, "permission.denied.customer_edit");
        return true;
      },
    );
  });
});
