import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import en from "@/i18n/locales/en";
import zhHans from "@/i18n/locales/zh-Hans";
import zhHant from "@/i18n/locales/zh-Hant";
import {
  ALLOWED_EXPORT_FIELDS,
  DEFAULT_EXPORT_FIELDS,
  ExportValidationError,
  applySensitiveFieldPolicy,
  validateRequestedExportFields,
} from "@/lib/export/customers/constants";
import { buildCustomersExportCsv } from "@/lib/export/customers/csv";
import type { CustomerExportRow } from "@/lib/export/customers/queries";

const root = process.cwd();

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

const BASELINE_DEFAULT_FIELDS = [
  "id",
  "customer_name",
  "customer_type",
  "phone_country_code",
  "phone",
  "wechat_id",
  "email",
  "source",
  "source_remark",
  "requested_project_name",
  "sales_stage",
  "status",
  "owner_name",
  "created_at",
  "updated_at",
  "last_follow_up_at",
  "last_valid_follow_up_at",
  "next_follow_up_at",
] as const;

function sampleRow(
  overrides: Partial<CustomerExportRow> = {},
): CustomerExportRow {
  return {
    id: "cust-1",
    customer_name: "王小明",
    name_status: "confirmed",
    customer_type: "individual",
    phone_country_code: "+86",
    phone: "13800138000",
    wechat_id: null,
    email: null,
    source: "referral",
    source_remark: null,
    requested_project_name: "移民项目",
    notes: "secret",
    sales_stage: "contacted",
    status: "active",
    owner_name: "Admin",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-02T00:00:00.000Z",
    last_follow_up_at: null,
    last_valid_follow_up_at: null,
    next_follow_up_at: null,
    ...overrides,
  };
}

describe("optional export name_status contract", () => {
  it("allows name_status but keeps it out of DEFAULT_EXPORT_FIELDS", () => {
    assert.equal(
      (ALLOWED_EXPORT_FIELDS as readonly string[]).includes("name_status"),
      true,
    );
    assert.equal(
      (DEFAULT_EXPORT_FIELDS as readonly string[]).includes("name_status"),
      false,
    );
    assert.deepEqual([...DEFAULT_EXPORT_FIELDS], [...BASELINE_DEFAULT_FIELDS]);
    assert.equal(DEFAULT_EXPORT_FIELDS.length, 18);
  });

  it("default fields request stays the original 18 columns", () => {
    const fields = validateRequestedExportFields(null);
    assert.deepEqual(fields, [...BASELINE_DEFAULT_FIELDS]);
  });

  it("unchecked default CSV header matches the original 18 columns", () => {
    const csv = buildCustomersExportCsv(
      [sampleRow()],
      [...DEFAULT_EXPORT_FIELDS],
    );
    const header = csv.replace(/^\uFEFF/, "").split("\n")[0];
    assert.equal(header, BASELINE_DEFAULT_FIELDS.join(","));
    assert.equal(header?.includes("name_status"), false);
  });

  it("checked fields append name_status only", () => {
    const fields = validateRequestedExportFields([
      ...DEFAULT_EXPORT_FIELDS,
      "name_status",
    ]);
    assert.deepEqual(fields, [...BASELINE_DEFAULT_FIELDS, "name_status"]);
    const csv = buildCustomersExportCsv([sampleRow()], fields);
    const header = csv.replace(/^\uFEFF/, "").split("\n")[0];
    assert.equal(header, [...BASELINE_DEFAULT_FIELDS, "name_status"].join(","));
  });

  it("exports pending placeholder name without suffix and pending status", () => {
    const fields = [...DEFAULT_EXPORT_FIELDS, "name_status"];
    const csv = buildCustomersExportCsv(
      [
        sampleRow({
          customer_name: "X先生",
          name_status: "pending",
        }),
      ],
      fields,
    );
    const line = csv.replace(/^\uFEFF/, "").split("\n")[1];
    assert.ok(line);
    assert.match(line, /,X先生,/);
    assert.equal(line.endsWith(",pending"), true);
    assert.equal(line.includes("姓名待確認"), false);
    assert.equal(line.includes("Name pending"), false);
  });

  it("exports confirmed real name with confirmed status", () => {
    const fields = [...DEFAULT_EXPORT_FIELDS, "name_status"];
    const csv = buildCustomersExportCsv(
      [
        sampleRow({
          customer_name: "王小明",
          name_status: "confirmed",
        }),
      ],
      fields,
    );
    const line = csv.replace(/^\uFEFF/, "").split("\n")[1];
    assert.ok(line);
    assert.match(line, /,王小明,/);
    assert.equal(line.endsWith(",confirmed"), true);
  });

  it("does not strip name_status when includeSensitive=false", () => {
    const fields = applySensitiveFieldPolicy(
      [...DEFAULT_EXPORT_FIELDS, "name_status"],
      false,
    );
    assert.equal(fields.includes("name_status"), true);
    assert.equal(fields.includes("phone"), false);
    assert.equal(fields.includes("notes"), false);
    assert.equal(fields.includes("source_remark"), false);
  });

  it("rejects unknown export fields", () => {
    assert.throws(
      () => validateRequestedExportFields(["customer_name", "not_a_field"]),
      (error: unknown) => {
        assert.ok(error instanceof ExportValidationError);
        assert.equal(error.code, "invalid_export_field");
        assert.deepEqual(error.invalidFields, ["not_a_field"]);
        return true;
      },
    );
  });

  it("keeps export admin gate and UI optional checkbox wiring", () => {
    const route = read("src/app/api/export/customers/route.ts");
    const permission = read("src/lib/permissions/export.ts");
    const ui = read(
      "src/app/(dashboard)/export/customers/export-customers-client.tsx",
    );
    const queries = read("src/lib/export/customers/queries.ts");

    assert.match(route, /requireExportAdmin/);
    assert.match(permission, /user\.role !== "admin"/);
    assert.match(ui, /includeNameStatus/);
    assert.match(ui, /DEFAULT_EXPORT_FIELDS/);
    assert.match(ui, /\.\.\.DEFAULT_EXPORT_FIELDS, "name_status"/);
    assert.match(queries, /name_status: schema\.customers\.nameStatus/);
    assert.doesNotMatch(ui, /field picker|ALLOWED_EXPORT_FIELDS\.map/i);
  });
});

describe("export includeNameStatus i18n parity", () => {
  it("matches product copy across locales", () => {
    assert.equal(zhHant.export.includeNameStatus, "包含姓名狀態");
    assert.equal(zhHans.export.includeNameStatus, "包含姓名状态");
    assert.equal(en.export.includeNameStatus, "Include name status");
    assert.equal(
      zhHant.export.includeNameStatusHint,
      "額外輸出 confirmed／pending，不影響原有欄位。",
    );
    assert.equal(
      zhHans.export.includeNameStatusHint,
      "额外输出 confirmed／pending，不影响原有字段。",
    );
    assert.equal(
      en.export.includeNameStatusHint,
      "Adds confirmed/pending without changing the existing fields.",
    );
  });
});
