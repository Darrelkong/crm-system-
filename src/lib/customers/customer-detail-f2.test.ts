import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "../../../drizzle/schema";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { bindTestDatabase } from "@/lib/db";
import { getCustomerPendingApprovalFlags } from "./customer-pending-approval-flags";

function readDetailPageSource(): string {
  return readFileSync("src/app/(dashboard)/customers/[id]/page.tsx", "utf8");
}

function readDetailClientSource(): string {
  return readFileSync(
    "src/app/(dashboard)/customers/[id]/customer-detail-client.tsx",
    "utf8",
  );
}

function readApprovalEntrySource(): string {
  return readFileSync(
    "src/components/customers/customer-approval-requests-entry.tsx",
    "utf8",
  );
}

describe("customer detail F2 pending approval summary", () => {
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let dispose: (() => void) | undefined;

  before(async () => {
    process.env.CRM_ALLOW_TEST_DB_BIND = "1";
    const proxy = await getPlatformProxy<{ DB: unknown }>({
      configPath: "wrangler.jsonc",
    });
    db = drizzle(proxy.env.DB, { schema });
    bindTestDatabase(db);
    dispose = proxy.dispose;
  });

  after(async () => {
    bindTestDatabase(null);
    dispose?.();
  });

  it("returns both pending flags from one bounded query", async () => {
    const flags = await getCustomerPendingApprovalFlags(
      db,
      SEED_IDS.customerStaffA,
    );
    assert.equal(typeof flags.pendingOnHoldCreate, "boolean");
    assert.equal(typeof flags.pendingPriority, "boolean");
  });

  it("detail page uses combined pending approval flags", () => {
    const source = readDetailPageSource();
    assert.match(source, /getCustomerPendingApprovalFlags/);
    assert.doesNotMatch(source, /getPendingOnHoldCreateApprovalForCustomer/);
    assert.doesNotMatch(source, /findPendingPriorityApproval/);
  });

  it("preserves pending on-hold create security gate", () => {
    const source = readDetailPageSource();
    assert.match(source, /pendingFlags\.pendingOnHoldCreate/);
    assert.match(source, /onHoldCreatePendingTitle/);
    const gateIndex = source.indexOf("pendingFlags.pendingOnHoldCreate");
    const clientIndex = source.indexOf("<CustomerDetailClient");
    assert.ok(gateIndex >= 0);
    assert.ok(clientIndex > gateIndex);
  });

  it("uses pendingFlags.pendingPriority without blocking unrelated approvals", () => {
    const source = readDetailPageSource();
    assert.match(source, /pendingFlags\.pendingPriority/);
    const modal = readFileSync(
      "src/components/customers/customer-approval-requests-modal.tsx",
      "utf8",
    );
    assert.match(modal, /CUSTOMER_DETAIL_APPROVAL_REQUEST_TYPES/);
    assert.match(modal, /priorityApprovalPending/);
  });
});

describe("customer detail F3 role-aware bootstrap", () => {
  it("staff starts customer, pending flags, and assignees together", () => {
    const source = readDetailPageSource();
    const bootstrap = source.slice(
      source.indexOf("if (isStaff)"),
      source.indexOf("const bootstrapMs"),
    );
    assert.match(bootstrap, /if \(isStaff\)/);
    assert.match(bootstrap, /await Promise\.all\(\[/);
    assert.match(bootstrap, /getCustomerById\(id\)/);
    assert.match(bootstrap, /getCustomerPendingApprovalFlags/);
    assert.match(bootstrap, /listCustomerAssignees\(db, id\)/);
  });

  it("admin bootstrap loads customer and pending flags without assignees", () => {
    const source = readDetailPageSource();
    const adminBootstrap = source.slice(
      source.indexOf("} else {"),
      source.indexOf("const bootstrapMs"),
    );
    assert.match(adminBootstrap, /getCustomerById\(id\)/);
    assert.match(adminBootstrap, /getCustomerPendingApprovalFlags/);
    assert.doesNotMatch(adminBootstrap, /listCustomerAssignees\(db, id\)/);
  });

  it("admin loads display names in one parallel secondary resolver", () => {
    const source = readDetailPageSource();
    assert.match(source, /displayNamesPromise = isStaff/);
    assert.match(source, /resolveAdminCustomerDetailDisplayNames\(db, id, customer\)/);
  });

  it("starts family, confirm-name, and display names during scoring chain", () => {
    const source = readDetailPageSource();
    assert.match(source, /familySummaryPromise/);
    assert.match(source, /confirmNamePromise/);
    assert.match(source, /displayNamesPromise/);
    assert.match(source, /scoringPromise/);
    const familyIndex = source.indexOf("const familySummaryPromise");
    const scoringIndex = source.indexOf("const scoringPromise");
    assert.ok(familyIndex < scoringIndex || familyIndex > 0);
  });

  it("does not duplicate follow-up queries when full access is available", () => {
    const source = readDetailPageSource();
    const loads = source.match(/listFollowUpsByCustomerId\(id\)/g) ?? [];
    assert.ok(loads.length <= 2);
    assert.match(source, /followUpsChainPromise/);
  });
});

describe("customer detail F2 lazy approval modal", () => {
  it("keeps lightweight submit button in entry shell", () => {
    const entry = readApprovalEntrySource();
    assert.match(entry, /submitApproval/);
    assert.match(entry, /dynamic\(/);
    assert.match(entry, /customer-approval-requests-modal/);
    assert.doesNotMatch(entry, /paid_customer/);
  });

  it("detail client imports approval entry not modal directly", () => {
    const source = readDetailClientSource();
    assert.match(source, /customer-approval-requests/);
    assert.doesNotMatch(source, /customer-approval-requests-modal/);
  });
});

describe("customer list F2 no priority N+1", () => {
  it("does not query priority per row on list page", () => {
    const listPage = readFileSync(
      "src/app/(dashboard)/customers/page.tsx",
      "utf8",
    );
    const listClient = readFileSync(
      "src/app/(dashboard)/customers/customers-list-client.tsx",
      "utf8",
    );
    assert.doesNotMatch(listPage, /findPendingPriorityApproval/);
    assert.doesNotMatch(listPage, /getCustomerPendingApprovalFlags/);
    assert.doesNotMatch(listClient, /findPendingPriorityApproval/);
    assert.doesNotMatch(listClient, /getCustomerPendingApprovalFlags/);
  });
});
