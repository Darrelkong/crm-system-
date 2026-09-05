import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "../../../drizzle/schema";
import type { Customer } from "../../../drizzle/schema/customers";
import type { User } from "../../../drizzle/schema/users";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { bindTestDatabase } from "@/lib/db";
import { getCustomerById } from "@/lib/customers/queries";
import { normalizeCollaboratorEmail } from "@/lib/customers/collaborator-verification";
import { verifyTransferTargetEmail } from "./transfer-target-verification";

type Db = ReturnType<typeof drizzle<typeof schema>>;

const CUSTOMER_ID = SEED_IDS.customerStaffA;
const ACTOR_ID = SEED_IDS.staffA;
const TARGET_ID = SEED_IDS.staffB;
const actor = { id: ACTOR_ID, role: "staff" } as User;

describe("exact transfer target verification", () => {
  let db: Db;
  let dispose: (() => Promise<void>) | undefined;
  let customer: Customer;
  let targetEmail: string;
  let actorEmail: string;

  before(async () => {
    process.env.CRM_ALLOW_TEST_DB_BIND = "1";
    const proxy = await getPlatformProxy<{ DB: unknown }>({
      configPath: "wrangler.jsonc",
    });
    db = drizzle(proxy.env.DB, { schema });
    bindTestDatabase(db);
    dispose = proxy.dispose;

    customer = (await getCustomerById(CUSTOMER_ID))!;
    const users = await db
      .select({
        id: schema.users.id,
        email: schema.users.email,
      })
      .from(schema.users);
    targetEmail = users.find((user) => user.id === TARGET_ID)!.email;
    actorEmail = users.find((user) => user.id === ACTOR_ID)!.email;
    await db
      .update(schema.users)
      .set({ isActive: 1, deletedAt: null })
      .where(eq(schema.users.id, TARGET_ID));
  });

  after(async () => {
    await db
      .update(schema.users)
      .set({ isActive: 1, deletedAt: null })
      .where(eq(schema.users.id, TARGET_ID));
    bindTestDatabase(null);
    delete process.env.CRM_ALLOW_TEST_DB_BIND;
    await dispose?.();
  });

  it("normalizes and resolves one exact active Staff email", async () => {
    const verified = await verifyTransferTargetEmail(db, {
      actor,
      customer,
      email: `  ${targetEmail.toUpperCase()} `,
    });

    assert.deepEqual(verified, {
      id: TARGET_ID,
      displayName: (
        await db
          .select({ displayName: schema.users.displayName })
          .from(schema.users)
          .where(eq(schema.users.id, TARGET_ID))
          .limit(1)
      )[0]!.displayName,
      email: normalizeCollaboratorEmail(targetEmail),
    });
  });

  it("returns the same generic null result for invalid or partial input", async () => {
    assert.equal(
      await verifyTransferTargetEmail(db, {
        actor,
        customer,
        email: "staff",
      }),
      null,
    );
    assert.equal(
      await verifyTransferTargetEmail(db, {
        actor,
        customer,
        email: targetEmail.split("@")[0],
      }),
      null,
    );
  });

  it("rejects self, inactive, and deleted targets without revealing eligibility", async () => {
    assert.equal(
      await verifyTransferTargetEmail(db, {
        actor,
        customer,
        email: actorEmail,
      }),
      null,
    );

    await db
      .update(schema.users)
      .set({ isActive: 0 })
      .where(eq(schema.users.id, TARGET_ID));
    assert.equal(
      await verifyTransferTargetEmail(db, {
        actor,
        customer,
        email: targetEmail,
      }),
      null,
    );

    await db
      .update(schema.users)
      .set({ isActive: 1, deletedAt: new Date().toISOString() })
      .where(eq(schema.users.id, TARGET_ID));
    assert.equal(
      await verifyTransferTargetEmail(db, {
        actor,
        customer,
        email: targetEmail,
      }),
      null,
    );
  });
});
