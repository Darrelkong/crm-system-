/**
 * Lightweight route-contract tests for draft organize override rejection.
 * Full HTTP auth/DB coverage is exercised via shared permission + quota tests.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hasFollowUpOrganizeClientOverride } from "@/lib/ai/follow-up-organize/response-safety";
import {
  PermissionError,
  assertCanAddFollowUp,
} from "@/lib/permissions/customers";
import type { Customer } from "../../../../../drizzle/schema/customers";
import type { User } from "../../../../../drizzle/schema/users";
import { SEED_IDS } from "@/lib/constants/seed-ids";

describe("draft organize route contract", () => {
  it("rejects provider/model/prompt/role/operationType overrides", () => {
    for (const key of [
      "role",
      "provider",
      "prompt",
      "model",
      "dailyLimit",
      "userId",
      "operationType",
    ] as const) {
      assert.equal(
        hasFollowUpOrganizeClientOverride({ mode: "ai", text: "x", [key]: "y" }),
        true,
        key,
      );
    }
  });
});

describe("customer organize permission gate order", () => {
  const staff = { id: SEED_IDS.staffB, role: "staff" } as User;
  const owned = {
    id: "c1",
    customerName: "X",
    status: "active",
    ownerId: SEED_IDS.staffA,
    deletedAt: null,
  } as Customer;

  it("denies unrelated staff before any quota reservation would occur", () => {
    assert.throws(
      () => assertCanAddFollowUp(staff, owned),
      (err: unknown) =>
        err instanceof PermissionError && err.status === 403,
    );
  });

  it("denies archived customers", () => {
    assert.throws(
      () =>
        assertCanAddFollowUp(
          { id: SEED_IDS.staffA, role: "staff" } as User,
          {
            ...owned,
            ownerId: SEED_IDS.staffA,
            status: "archived",
            deletedAt: "2026-01-01T00:00:00.000Z",
          } as Customer,
        ),
      (err: unknown) => err instanceof PermissionError,
    );
  });
});
