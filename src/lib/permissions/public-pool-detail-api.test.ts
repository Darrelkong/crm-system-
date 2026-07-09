import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "../../../drizzle/schema";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { bindTestDatabase, getDb } from "@/lib/db";
import { getCustomerById } from "@/lib/customers/queries";
import {
  assertCanViewCustomerTimeline,
  getCustomerTimeline,
} from "@/lib/customers/timeline/service";
import {
  assertStaffCanViewCustomerDetailPage,
  PermissionError,
} from "./customers";
import type { User } from "../../../drizzle/schema/users";

const staffA = { id: SEED_IDS.staffA, role: "staff" } as User;
const admin = { id: SEED_IDS.admin, role: "admin" } as User;

describe("public pool detail and timeline API guards", () => {
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let dispose: (() => Promise<void>) | undefined;

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
    delete process.env.CRM_ALLOW_TEST_DB_BIND;
    await dispose?.();
  });

  it("staff public_pool detail assert returns PUBLIC_POOL_DETAIL_DENIED", async () => {
    const customer = await getCustomerById(SEED_IDS.customerPublicPool);
    assert.ok(customer);
    assert.equal(customer.status, "public_pool");

    assert.throws(
      () => assertStaffCanViewCustomerDetailPage(staffA, customer),
      (err: unknown) => {
        assert.ok(err instanceof PermissionError);
        assert.equal(err.auditAction, "PUBLIC_POOL_DETAIL_DENIED");
        return true;
      },
    );
  });

  it("admin public_pool detail assert is allowed", async () => {
    const customer = await getCustomerById(SEED_IDS.customerPublicPool);
    assert.ok(customer);
    assert.doesNotThrow(() =>
      assertStaffCanViewCustomerDetailPage(admin, customer),
    );
  });

  it("staff owned active customer detail assert is allowed", async () => {
    const customer = await getCustomerById(SEED_IDS.customerStaffA);
    assert.ok(customer);
    assert.equal(customer.ownerId, SEED_IDS.staffA);
    assert.doesNotThrow(() =>
      assertStaffCanViewCustomerDetailPage(staffA, customer),
    );
  });

  it("staff public_pool timeline returns PUBLIC_POOL_TIMELINE_DENIED", async () => {
    const customer = await getCustomerById(SEED_IDS.customerPublicPool);
    assert.ok(customer);

    assert.throws(
      () => assertCanViewCustomerTimeline(staffA, customer),
      (err: unknown) => {
        assert.ok(err instanceof PermissionError);
        assert.equal(err.auditAction, "PUBLIC_POOL_TIMELINE_DENIED");
        return true;
      },
    );

    await assert.rejects(
      () => getCustomerTimeline(getDb(), staffA, customer),
      (err: unknown) => {
        assert.ok(err instanceof PermissionError);
        assert.equal(err.auditAction, "PUBLIC_POOL_TIMELINE_DENIED");
        return true;
      },
    );
  });

  it("admin public_pool timeline is allowed", async () => {
    const customer = await getCustomerById(SEED_IDS.customerPublicPool);
    assert.ok(customer);

    const timeline = await getCustomerTimeline(getDb(), admin, customer);
    assert.ok(Array.isArray(timeline.items));
    assert.equal(timeline.accessLevel, "full");
  });

  it("staff active owner timeline is allowed", async () => {
    const customer = await getCustomerById(SEED_IDS.customerStaffA);
    assert.ok(customer);

    const timeline = await getCustomerTimeline(getDb(), staffA, customer);
    assert.ok(Array.isArray(timeline.items));
    assert.equal(timeline.accessLevel, "full");
  });

  it("staff non-owner active customer timeline remains denied (not public pool rule)", async () => {
    const customer = await getCustomerById(SEED_IDS.customerStaffB);
    assert.ok(customer);
    assert.notEqual(customer.status, "public_pool");

    await assert.rejects(
      () => getCustomerTimeline(getDb(), staffA, customer),
      (err: unknown) => {
        assert.ok(err instanceof PermissionError);
        assert.notEqual(err.auditAction, "PUBLIC_POOL_TIMELINE_DENIED");
        return true;
      },
    );
  });
});
