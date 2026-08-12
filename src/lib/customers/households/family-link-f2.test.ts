import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "../../../../drizzle/schema";
import type { User } from "../../../../drizzle/schema/users";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { bindTestDatabase } from "@/lib/db";
import {
  parsePhoneExactInput,
  searchFamilyCandidates,
} from "./family-candidates";
import { FAMILY_ERROR_CODES, FamilyLinkError } from "./errors";

const NOW = "2026-08-12T20:00:00.000Z";
const staffA = { id: SEED_IDS.staffA, role: "staff" } as User;

const SOURCE = "f2-source";
const DANIEL = "f2-daniel";
const ALICE = "f2-alice";
const MICHAEL = "f2-michael";
const JOHN_PROTECTED = "f2-john-protected";
const WECHAT_PROTECTED = "f2-wechat-protected";
const VISIBLE_WECHAT = "f2-visible-wechat";
const CODE_VISIBLE = "f2-code-visible";
const CODE_PROTECTED = "f2-code-protected";
const EMAIL_VISIBLE = "f2-email-visible";
const EMAIL_PROTECTED = "f2-email-protected";
const PHONE_CN = "f2-phone-cn";
const PHONE_HK = "f2-phone-hk";
const PHONE_US = "f2-phone-us";
const PHONE_DUP_A = "f2-phone-dup-a";
const PHONE_DUP_B = "f2-phone-dup-b";

function customerRow(
  id: string,
  ownerId: string,
  overrides: Partial<typeof schema.customers.$inferInsert> = {},
) {
  return {
    id,
    customerName: `F2 ${id}`,
    customerType: "individual" as const,
    source: "referral",
    ownerId,
    status: "active" as const,
    createdBy: ownerId,
    updatedBy: ownerId,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  } satisfies typeof schema.customers.$inferInsert;
}

function broad(
  db: ReturnType<typeof drizzle<typeof schema>>,
  source: typeof schema.customers.$inferSelect,
  q: string,
) {
  return searchFamilyCandidates(db, staffA, source, { q, mode: "broad" });
}

function exact(
  db: ReturnType<typeof drizzle<typeof schema>>,
  source: typeof schema.customers.$inferSelect,
  kind: "customerCode" | "phone" | "wechatId" | "email",
  q: string,
) {
  return searchFamilyCandidates(db, staffA, source, { q, mode: "exact", kind });
}

function assertProtectedDtoOnly(result: unknown) {
  assert.deepEqual(result, { isMasked: true, requiresApproval: true });
  const json = JSON.stringify(result);
  assert.doesNotMatch(json, /customerId|customerName|customerCode|phone|email|wechat/i);
}

describe("family link F2 search intent", () => {
  let dispose: (() => Promise<void>) | undefined;
  let db: ReturnType<typeof drizzle<typeof schema>>;

  before(async () => {
    const proxy = await getPlatformProxy({ configPath: "./wrangler.jsonc" });
    dispose = proxy.dispose;
    db = drizzle(proxy.env.DB, { schema });
    bindTestDatabase(db);

    const ids = [
      SOURCE,
      DANIEL,
      ALICE,
      MICHAEL,
      JOHN_PROTECTED,
      WECHAT_PROTECTED,
      VISIBLE_WECHAT,
      CODE_VISIBLE,
      CODE_PROTECTED,
      EMAIL_VISIBLE,
      EMAIL_PROTECTED,
      PHONE_CN,
      PHONE_HK,
      PHONE_US,
      PHONE_DUP_A,
      PHONE_DUP_B,
    ];
    for (const id of ids) {
      await db.delete(schema.customers).where(eq(schema.customers.id, id));
    }

    await db.insert(schema.customers).values(
      customerRow(SOURCE, SEED_IDS.staffA, { customerName: "F2 Source" }),
    );
    await db.insert(schema.customers).values(
      customerRow(DANIEL, SEED_IDS.staffA, {
        customerName: "Daniel Smith",
        wechatId: "daniel_wx_99",
      }),
    );
    await db.insert(schema.customers).values(
      customerRow(ALICE, SEED_IDS.staffA, {
        customerName: "Alice Wong",
        wechatId: "alice_wx_88",
      }),
    );
    await db.insert(schema.customers).values(
      customerRow(MICHAEL, SEED_IDS.staffA, {
        customerName: "Michael Lee",
        wechatId: "michael_wx_77",
      }),
    );
    await db.insert(schema.customers).values(
      customerRow(JOHN_PROTECTED, SEED_IDS.staffB, {
        customerName: "John Smith",
        wechatId: "some_other_id",
      }),
    );
    await db.insert(schema.customers).values(
      customerRow(WECHAT_PROTECTED, SEED_IDS.staffB, {
        customerName: "Different Name",
        wechatId: "john",
      }),
    );
    await db.insert(schema.customers).values(
      customerRow(VISIBLE_WECHAT, SEED_IDS.staffA, {
        customerName: "Visible WeChat Owner",
        wechatId: "visible_wx_01",
      }),
    );
    await db.insert(schema.customers).values(
      customerRow(CODE_VISIBLE, SEED_IDS.staffA, {
        customerName: "Code Visible",
        customerCode: "EF000123",
      }),
    );
    await db.insert(schema.customers).values(
      customerRow(CODE_PROTECTED, SEED_IDS.staffB, {
        customerName: "Code Protected",
        customerCode: "EF000124",
      }),
    );
    await db.insert(schema.customers).values(
      customerRow(EMAIL_VISIBLE, SEED_IDS.staffA, {
        customerName: "Email Visible",
        email: "Visible.Person@Example.com",
      }),
    );
    await db.insert(schema.customers).values(
      customerRow(EMAIL_PROTECTED, SEED_IDS.staffB, {
        customerName: "Email Protected",
        email: "protected.person@example.com",
      }),
    );
    await db.insert(schema.customers).values(
      customerRow(PHONE_CN, SEED_IDS.staffA, {
        customerName: "Phone CN",
        phoneCountryCode: "+86",
        phone: "13800138888",
      }),
    );
    await db.insert(schema.customers).values(
      customerRow(PHONE_HK, SEED_IDS.staffB, {
        customerName: "Phone HK",
        phoneCountryCode: "+852",
        phone: "91234567",
      }),
    );
    await db.insert(schema.customers).values(
      customerRow(PHONE_US, SEED_IDS.staffB, {
        customerName: "Phone US",
        phoneCountryCode: "+1",
        phone: "4155552671",
      }),
    );
    await db.insert(schema.customers).values(
      customerRow(PHONE_DUP_A, SEED_IDS.staffB, {
        customerName: "Phone Dup A",
        phoneCountryCode: "+86",
        phone: "90001111",
      }),
    );
    await db.insert(schema.customers).values(
      customerRow(PHONE_DUP_B, SEED_IDS.staffB, {
        customerName: "Phone Dup B",
        phoneCountryCode: "+852",
        phone: "90001111",
      }),
    );
  });

  after(async () => {
    await dispose?.();
  });

  it("broad English name Daniel returns visible customer by name", async () => {
    const source = (
      await db.select().from(schema.customers).where(eq(schema.customers.id, SOURCE)).limit(1)
    )[0]!;
    const results = await broad(db, source, "Daniel");
    assert.ok(results.some((row) => !row.isMasked && row.customerId === DANIEL));
  });

  it("broad English name Alice returns visible customer by name", async () => {
    const source = (
      await db.select().from(schema.customers).where(eq(schema.customers.id, SOURCE)).limit(1)
    )[0]!;
    const results = await broad(db, source, "Alice");
    assert.ok(results.some((row) => !row.isMasked && row.customerId === ALICE));
  });

  it("broad English name Daniel Smith returns visible customer", async () => {
    const source = (
      await db.select().from(schema.customers).where(eq(schema.customers.id, SOURCE)).limit(1)
    )[0]!;
    const results = await broad(db, source, "Daniel Smith");
    assert.ok(results.some((row) => !row.isMasked && row.customerId === DANIEL));
  });

  it("broad English name Michael returns visible customer by name", async () => {
    const source = (
      await db.select().from(schema.customers).where(eq(schema.customers.id, SOURCE)).limit(1)
    )[0]!;
    const results = await broad(db, source, "Michael");
    assert.ok(results.some((row) => !row.isMasked && row.customerId === MICHAEL));
  });

  it("broad protected English name John is invisible", async () => {
    const source = (
      await db.select().from(schema.customers).where(eq(schema.customers.id, SOURCE)).limit(1)
    )[0]!;
    for (const q of ["John", "John Smith"]) {
      const results = await broad(db, source, q);
      assert.equal(results.length, 0);
      assert.ok(!results.some((row) => row.isMasked));
    }
  });

  it("broad john does not reveal protected wechatId=john", async () => {
    const source = (
      await db.select().from(schema.customers).where(eq(schema.customers.id, SOURCE)).limit(1)
    )[0]!;
    const results = await broad(db, source, "john");
    assert.equal(results.length, 0);
    assert.ok(!results.some((row) => row.isMasked));
  });

  it("explicit exact wechatId=john returns masked generic result", async () => {
    const source = (
      await db.select().from(schema.customers).where(eq(schema.customers.id, SOURCE)).limit(1)
    )[0]!;
    const results = await exact(db, source, "wechatId", "john");
    assert.equal(results.length, 1);
    assertProtectedDtoOnly(results[0]);
  });

  it("explicit exact visible WeChat returns minimal visible DTO", async () => {
    const source = (
      await db.select().from(schema.customers).where(eq(schema.customers.id, SOURCE)).limit(1)
    )[0]!;
    const results = await exact(db, source, "wechatId", "visible_wx_01");
    assert.equal(results.length, 1);
    const row = results[0]!;
    assert.equal(row.isMasked, false);
    if (!row.isMasked) {
      assert.equal(row.customerId, VISIBLE_WECHAT);
      assert.equal(row.customerName, "Visible WeChat Owner");
    }
  });

  it("customerCode exact visible returns minimal visible DTO", async () => {
    const source = (
      await db.select().from(schema.customers).where(eq(schema.customers.id, SOURCE)).limit(1)
    )[0]!;
    const results = await exact(db, source, "customerCode", "EF000123");
    assert.equal(results.length, 1);
    const row = results[0]!;
    assert.equal(row.isMasked, false);
    if (!row.isMasked) {
      assert.equal(row.customerId, CODE_VISIBLE);
    }
  });

  it("customerCode exact protected returns masked generic DTO", async () => {
    const source = (
      await db.select().from(schema.customers).where(eq(schema.customers.id, SOURCE)).limit(1)
    )[0]!;
    const results = await exact(db, source, "customerCode", "EF000124");
    assert.equal(results.length, 1);
    assertProtectedDtoOnly(results[0]);
  });

  it("email exact visible returns minimal visible DTO", async () => {
    const source = (
      await db.select().from(schema.customers).where(eq(schema.customers.id, SOURCE)).limit(1)
    )[0]!;
    const results = await exact(db, source, "email", "Visible.Person@Example.com");
    assert.equal(results.length, 1);
    const row = results[0]!;
    assert.equal(row.isMasked, false);
    if (!row.isMasked) {
      assert.equal(row.customerId, EMAIL_VISIBLE);
    }
  });

  it("email exact protected returns masked generic DTO", async () => {
    const source = (
      await db.select().from(schema.customers).where(eq(schema.customers.id, SOURCE)).limit(1)
    )[0]!;
    const results = await exact(db, source, "email", "protected.person@example.com");
    assert.equal(results.length, 1);
    assertProtectedDtoOnly(results[0]);
  });

  it("phone exact +86 matches stored CN customer", async () => {
    const source = (
      await db.select().from(schema.customers).where(eq(schema.customers.id, SOURCE)).limit(1)
    )[0]!;
    const results = await exact(db, source, "phone", "+86 13800138888");
    assert.ok(results.some((row) => !row.isMasked && row.customerId === PHONE_CN));
  });

  it("phone exact +852 matches stored HK customer without +86 normalization", async () => {
    const source = (
      await db.select().from(schema.customers).where(eq(schema.customers.id, SOURCE)).limit(1)
    )[0]!;
    const parsed = parsePhoneExactInput("+852 9123 4567");
    assert.equal(parsed?.variant, "international");
    if (parsed?.variant === "international") {
      assert.equal(parsed.identity, "+85291234567");
      assert.notEqual(parsed.identity, "+8685291234567");
    }
    const results = await exact(db, source, "phone", "+852 9123 4567");
    assert.equal(results.length, 1);
    assertProtectedDtoOnly(results[0]);
  });

  it("phone exact +1 matches stored US customer", async () => {
    const source = (
      await db.select().from(schema.customers).where(eq(schema.customers.id, SOURCE)).limit(1)
    )[0]!;
    const results = await exact(db, source, "phone", "+1 4155552671");
    assert.equal(results.length, 1);
    assertProtectedDtoOnly(results[0]);
  });

  it("national-only duplicate across country codes is ambiguous", async () => {
    const source = (
      await db.select().from(schema.customers).where(eq(schema.customers.id, SOURCE)).limit(1)
    )[0]!;
    await assert.rejects(
      () => exact(db, source, "phone", "90001111"),
      (error: unknown) =>
        error instanceof FamilyLinkError &&
        error.errorCode === FAMILY_ERROR_CODES.PROTECTED_MATCH_AMBIGUOUS,
    );
  });

  it("broad query count remains bounded without per-candidate assignee queries", async () => {
    const proxy = await getPlatformProxy({ configPath: "./wrangler.jsonc" });
    let queryCount = 0;
    const rawDb = proxy.env.DB as {
      prepare: (query: string) => unknown;
      batch: (statements: readonly unknown[]) => Promise<unknown>;
      exec: (query: string) => Promise<unknown>;
      withSession?: (...args: unknown[]) => unknown;
      dump?: () => Promise<ArrayBuffer>;
    };
    const wrappedDb = {
      prepare(query: string) {
        queryCount++;
        return rawDb.prepare(query);
      },
      batch: (statements: readonly unknown[]) => {
        queryCount += statements.length;
        return rawDb.batch(statements);
      },
      exec: (query: string) => rawDb.exec(query),
      withSession: (...args: unknown[]) => rawDb.withSession?.(...args),
      dump: () => rawDb.dump?.() ?? Promise.resolve(new ArrayBuffer(0)),
    };
    const counterDb = drizzle(wrappedDb as typeof proxy.env.DB, { schema });
    bindTestDatabase(counterDb);

    const source = (
      await counterDb
        .select()
        .from(schema.customers)
        .where(eq(schema.customers.id, SOURCE))
        .limit(1)
    )[0]!;

    queryCount = 0;
    await broad(counterDb, source, "Daniel");
    const singleCount = queryCount;

    queryCount = 0;
    await broad(counterDb, source, "Smith");
    const multiCount = queryCount;

    assert.equal(multiCount, singleCount);
    assert.ok(multiCount <= 2);

    await proxy.dispose();
    bindTestDatabase(db);
  });
});
