import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "../../../../drizzle/schema";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { bindTestDatabase } from "@/lib/db";
import { IMPORT_CSV_COLUMNS, IMPORT_TEMPLATE_HEADER } from "./constants";
import { precheckCustomerImport } from "./precheck";
import type { User } from "../../../../drizzle/schema/users";

const adminUser = { id: SEED_IDS.admin, role: "admin" } as User;

const STAFF_A_PHONE = "13800000001";
const STAFF_A_WECHAT = "staff_a_wechat";
const STAFF_A_EMAIL = "staff-a-customer@example.com";

const TEMP_ARCHIVED_ID = "import-precheck-archived-00000001";
const TEMP_ARCHIVED_PHONE = "19988000001";
const TEMP_CONTACT_CUSTOMER_ID = "import-precheck-contact-cust-0001";
const TEMP_CONTACT_ID = "import-precheck-contact-row-0001";
const TEMP_CONTACT_PHONE = "19988000002";
const TEMP_CONTACT_WECHAT = "ImportContact_Wx";
const TEMP_CONTACT_EMAIL = "Import.Contact@Example.com";

function buildCsv(
  rows: Array<Partial<Record<(typeof IMPORT_CSV_COLUMNS)[number], string>>>,
): string {
  const lines = rows.map((row) =>
    IMPORT_CSV_COLUMNS.map((col) => row[col] ?? "").join(","),
  );
  return [IMPORT_TEMPLATE_HEADER, ...lines].join("\n");
}

function baseRow(
  overrides: Partial<Record<(typeof IMPORT_CSV_COLUMNS)[number], string>> = {},
): Partial<Record<(typeof IMPORT_CSV_COLUMNS)[number], string>> {
  return {
    customer_name: "导入测试客户",
    customer_type: "individual",
    phone_country_code: "+86",
    phone: "19988009901",
    wechat_id: "",
    email: "",
    source: "xianyu_taobao",
    source_remark: "",
    requested_project_name: "香港银行账户",
    notes: "首次沟通记录内容足够长度用于导入",
    sales_stage: "new_lead",
    ...overrides,
  };
}

function hasDupCode(
  errors: Array<{ code: string; rowNumber: number }>,
  code: string,
): boolean {
  return errors.some((e) => e.code === code);
}

describe("precheckCustomerImport duplicate harden", () => {
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
    await db
      .delete(schema.customerContacts)
      .where(eq(schema.customerContacts.id, TEMP_CONTACT_ID));
    for (const id of [TEMP_ARCHIVED_ID, TEMP_CONTACT_CUSTOMER_ID]) {
      await db.delete(schema.customers).where(eq(schema.customers.id, id));
    }
    bindTestDatabase(null);
    delete process.env.CRM_ALLOW_TEST_DB_BIND;
    await dispose?.();
  });

  it("matches existing email after trim + lowercase", async () => {
    const result = await precheckCustomerImport(
      buildCsv([
        baseRow({
          phone: "19988001101",
          email: `  ${STAFF_A_EMAIL.toUpperCase()}  `,
        }),
      ]),
      adminUser,
    );
    assert.equal(hasDupCode(result.errors, "duplicate_email_db"), true);
  });

  it("matches WeChat case-insensitively against DB", async () => {
    const result = await precheckCustomerImport(
      buildCsv([
        baseRow({
          phone: "",
          wechat_id: STAFF_A_WECHAT.toUpperCase(),
        }),
      ]),
      adminUser,
    );
    assert.equal(hasDupCode(result.errors, "duplicate_wechatId_db"), true);
  });

  it("matches same +86 phone with separators via normalize", async () => {
    const result = await precheckCustomerImport(
      buildCsv([
        baseRow({
          phone_country_code: "+86",
          phone: "138-0000-0001",
        }),
      ]),
      adminUser,
    );
    assert.equal(hasDupCode(result.errors, "duplicate_phone_db"), true);
  });

  it("does not match same national digits under a different country code", async () => {
    const result = await precheckCustomerImport(
      buildCsv([
        baseRow({
          phone_country_code: "+1",
          phone: STAFF_A_PHONE,
          wechat_id: "unique_wx_diff_cc_001",
        }),
      ]),
      adminUser,
    );
    assert.equal(hasDupCode(result.errors, "duplicate_phone_db"), false);
  });

  it("still flags archived / recycle-bin customers as duplicates", async () => {
    const now = new Date().toISOString();
    await db.insert(schema.customers).values({
      id: TEMP_ARCHIVED_ID,
      customerName: "导入归档客户",
      phoneCountryCode: "+86",
      phone: TEMP_ARCHIVED_PHONE,
      source: "other",
      status: "archived",
      deletedAt: now,
      ownerId: SEED_IDS.admin,
      createdBy: SEED_IDS.admin,
      createdAt: now,
      updatedAt: now,
    });

    try {
      const result = await precheckCustomerImport(
        buildCsv([
          baseRow({
            phone: TEMP_ARCHIVED_PHONE,
            wechat_id: "unique_wx_archived_001",
          }),
        ]),
        adminUser,
      );
      assert.equal(hasDupCode(result.errors, "duplicate_phone_db"), true);
    } finally {
      await db
        .delete(schema.customers)
        .where(eq(schema.customers.id, TEMP_ARCHIVED_ID));
    }
  });

  it("matches secondary customer_contacts email / wechat / phone", async () => {
    const now = new Date().toISOString();
    await db.insert(schema.customers).values({
      id: TEMP_CONTACT_CUSTOMER_ID,
      customerName: "导入次要联络客户",
      phoneCountryCode: "+86",
      phone: "18888009999",
      source: "other",
      status: "active",
      ownerId: SEED_IDS.admin,
      createdBy: SEED_IDS.admin,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.customerContacts).values({
      id: TEMP_CONTACT_ID,
      customerId: TEMP_CONTACT_CUSTOMER_ID,
      name: "次要联系人",
      phone: TEMP_CONTACT_PHONE,
      wechatId: TEMP_CONTACT_WECHAT,
      email: TEMP_CONTACT_EMAIL,
      isPrimary: 0,
      createdAt: now,
      updatedAt: now,
    });

    try {
      const emailHit = await precheckCustomerImport(
        buildCsv([
          baseRow({
            phone: "19988002201",
            email: "import.contact@example.com",
          }),
        ]),
        adminUser,
      );
      assert.equal(hasDupCode(emailHit.errors, "duplicate_email_db"), true);

      const wechatHit = await precheckCustomerImport(
        buildCsv([
          baseRow({
            phone: "",
            wechat_id: "importcontact_wx",
          }),
        ]),
        adminUser,
      );
      assert.equal(hasDupCode(wechatHit.errors, "duplicate_wechatId_db"), true);

      const phoneHit = await precheckCustomerImport(
        buildCsv([
          baseRow({
            phone: TEMP_CONTACT_PHONE,
            wechat_id: "unique_wx_sec_phone_001",
          }),
        ]),
        adminUser,
      );
      assert.equal(hasDupCode(phoneHit.errors, "duplicate_phone_db"), true);
    } finally {
      await db
        .delete(schema.customerContacts)
        .where(eq(schema.customerContacts.id, TEMP_CONTACT_ID));
      await db
        .delete(schema.customers)
        .where(eq(schema.customers.id, TEMP_CONTACT_CUSTOMER_ID));
    }
  });

  it("flags in-batch CSV duplicates for phone / wechat / email", async () => {
    const result = await precheckCustomerImport(
      buildCsv([
        baseRow({
          customer_name: "批次甲",
          phone: "19988003301",
          wechat_id: "Batch_Wx_Same",
          email: "batch.same@example.com",
        }),
        baseRow({
          customer_name: "批次乙",
          phone: "199-8800-3301",
          wechat_id: "batch_wx_same",
          email: "  BATCH.SAME@EXAMPLE.COM ",
        }),
      ]),
      adminUser,
    );
    assert.equal(hasDupCode(result.errors, "duplicate_phone_csv"), true);
    assert.equal(hasDupCode(result.errors, "duplicate_wechatId_csv"), true);
    assert.equal(hasDupCode(result.errors, "duplicate_email_csv"), true);
    assert.ok(result.duplicateRows >= 1);
  });

  it("does not emit duplicate_* when contacts are unique vs DB and CSV", async () => {
    const result = await precheckCustomerImport(
      buildCsv([
        baseRow({
          customer_name: "唯一导入客户",
          phone: "19988004401",
          wechat_id: "unique_import_wx_4401",
          email: "unique.import.4401@example.com",
        }),
      ]),
      adminUser,
    );
    const dupErrors = result.errors.filter((e) =>
      e.code.startsWith("duplicate_"),
    );
    assert.deepEqual(dupErrors, []);
  });
});
