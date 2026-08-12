import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "../../../../drizzle/schema";
import type { User } from "../../../../drizzle/schema/users";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { bindTestDatabase } from "@/lib/db";
import { translate } from "@/i18n/translate";
import en from "@/i18n/locales/en";
import zhHans from "@/i18n/locales/zh-Hans";
import zhHant from "@/i18n/locales/zh-Hant";
import { formatHongKongDateTime } from "@/lib/timezone";
import {
  searchFamilyCandidates,
  type FamilyCandidateResult,
  type FamilyCandidateVisible,
} from "./family-candidates";

const root = process.cwd();
const NOW = "2026-08-12T11:36:00.000Z";
const staffA = { id: SEED_IDS.staffA, role: "staff" } as User;

const SOURCE = "u1-source";
const VISIBLE = "u1-visible";

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

function assertVisibleDtoOnly(row: FamilyCandidateVisible) {
  const keys = Object.keys(row).sort();
  assert.deepEqual(keys, [
    "createdAt",
    "customerId",
    "customerName",
    "isMasked",
    "linkMode",
  ]);
  const json = JSON.stringify(row);
  assert.doesNotMatch(
    json,
    /customerCode|phone|email|wechatId|ownerId|salesStage/i,
  );
  assert.equal(row.isMasked, false);
  assert.match(row.createdAt, /^\d{4}-\d{2}-\d{2}/);
}

function assertProtectedDtoOnly(result: FamilyCandidateResult) {
  assert.deepEqual(result, { isMasked: true, requiresApproval: true });
  const json = JSON.stringify(result);
  assert.doesNotMatch(
    json,
    /customerId|customerName|customerCode|createdAt|phone|email|wechat/i,
  );
}

describe("U1 family candidate display polish", () => {
  let dispose: (() => Promise<void>) | undefined;
  let db: ReturnType<typeof drizzle<typeof schema>>;

  before(async () => {
    const proxy = await getPlatformProxy({ configPath: "./wrangler.jsonc" });
    dispose = proxy.dispose;
    db = drizzle(proxy.env.DB, { schema });
    bindTestDatabase(db);

    for (const id of [SOURCE, VISIBLE]) {
      await db.delete(schema.customers).where(eq(schema.customers.id, id));
    }

    await db.insert(schema.customers).values({
      id: SOURCE,
      customerName: "U1 Source",
      customerType: "individual",
      source: "referral",
      ownerId: SEED_IDS.staffA,
      status: "active",
      createdBy: SEED_IDS.staffA,
      updatedBy: SEED_IDS.staffA,
      createdAt: NOW,
      updatedAt: NOW,
    });
    await db.insert(schema.customers).values({
      id: VISIBLE,
      customerName: "张三",
      customerCode: "EFU10001",
      customerType: "individual",
      source: "referral",
      ownerId: SEED_IDS.staffA,
      status: "active",
      createdBy: SEED_IDS.staffA,
      updatedBy: SEED_IDS.staffA,
      createdAt: NOW,
      updatedAt: NOW,
    });
  });

  after(async () => {
    for (const id of [SOURCE, VISIBLE]) {
      await db.delete(schema.customers).where(eq(schema.customers.id, id));
    }
    await dispose?.();
  });

  it("visible DTO serializes without customerCode or contact fields", async () => {
    const source = (
      await db.select().from(schema.customers).where(eq(schema.customers.id, SOURCE)).limit(1)
    )[0]!;
    const results = await searchFamilyCandidates(db, staffA, source, {
      q: "EFU10001",
      mode: "exact",
      kind: "customerCode",
    });
    assert.equal(results.length, 1);
    const row = results[0]!;
    assert.equal(row.isMasked, false);
    if (!row.isMasked) {
      assertVisibleDtoOnly(row);
      assert.equal(row.customerId, VISIBLE);
      assert.equal(row.customerName, "张三");
      assert.equal(row.createdAt, NOW);
    }
  });

  it("customerCode exact lookup still finds visible customer", async () => {
    const source = (
      await db.select().from(schema.customers).where(eq(schema.customers.id, SOURCE)).limit(1)
    )[0]!;
    const results = await searchFamilyCandidates(db, staffA, source, {
      q: "EFU10001",
      mode: "exact",
      kind: "customerCode",
    });
    assert.equal(results.length, 1);
    assert.equal(results[0]!.isMasked, false);
    if (!results[0]!.isMasked) {
      assert.equal(results[0]!.customerId, VISIBLE);
    }
  });

  it("protected DTO remains generic without createdAt", async () => {
    const protectedId = "u1-protected";
    await db.delete(schema.customers).where(eq(schema.customers.id, protectedId));
    await db.insert(schema.customers).values({
      id: protectedId,
      customerName: "Protected U1",
      customerCode: "EFU10999",
      customerType: "individual",
      source: "referral",
      ownerId: SEED_IDS.staffB,
      status: "active",
      createdBy: SEED_IDS.staffB,
      updatedBy: SEED_IDS.staffB,
      createdAt: NOW,
      updatedAt: NOW,
    });

    const source = (
      await db.select().from(schema.customers).where(eq(schema.customers.id, SOURCE)).limit(1)
    )[0]!;
    const results = await searchFamilyCandidates(db, staffA, source, {
      q: "EFU10999",
      mode: "exact",
      kind: "customerCode",
    });
    assert.equal(results.length, 1);
    assertProtectedDtoOnly(results[0]!);

    await db.delete(schema.customers).where(eq(schema.customers.id, protectedId));
  });
});

describe("U1 family candidate UI and i18n", () => {
  it("modal renders created time instead of customer code", () => {
    const modal = read("src/components/customers/customer-family-link-existing-modal.tsx");
    assert.match(modal, /familyCandidateCreatedAt/);
    assert.match(modal, /formatHongKongDateTime\(candidate\.createdAt\)/);
    assert.doesNotMatch(modal, /candidate\.customerCode/);
  });

  it("formats created time without seconds in Hong Kong timezone", () => {
    const formatted = formatHongKongDateTime(NOW);
    assert.equal(formatted, "2026-08-12 19:36");
    assert.doesNotMatch(formatted, /:\d{2}:\d{2}/);
  });

  it("interpolates familyCandidateCreatedAt in all locales", () => {
    const time = "2026-08-12 19:36";
    assert.equal(
      translate(zhHans, "customers.familyCandidateCreatedAt", { time }),
      "建立时间：2026-08-12 19:36",
    );
    assert.equal(
      translate(zhHant, "customers.familyCandidateCreatedAt", { time }),
      "建立時間：2026-08-12 19:36",
    );
    assert.equal(
      translate(en, "customers.familyCandidateCreatedAt", { time }),
      "Created: 2026-08-12 19:36",
    );
  });
});
