import { inArray, or } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { validateCustomerInput } from "@/lib/customers/validation";
import type { DuplicateField } from "@/lib/customers/duplicate-check";
import {
  isEmptyImportRow,
  parseCustomerImportCsv,
} from "@/lib/import/customers/csv";
import type {
  ImportIssue,
  ImportPreviewRow,
  ParsedImportRow,
  PrecheckResult,
} from "@/lib/import/customers/types";
import type { User } from "../../../../drizzle/schema/users";
import {
  IMPORT_DEFAULTS,
  IMPORT_DEFAULT_WARNINGS,
} from "@/lib/import/customers/defaults";
import type { ImportCsvColumn } from "@/lib/import/customers/constants";

const CSV_FIELD_TO_INPUT: Record<string, string> = {
  customer_name: "customerName",
  customer_type: "customerType",
  phone_country_code: "phoneCountryCode",
  phone: "phone",
  wechat_id: "wechatId",
  email: "email",
  source: "source",
  source_remark: "sourceRemark",
  notes: "notes",
  sales_stage: "salesStage",
};

function toParsedRow(
  rowNumber: number,
  raw: Record<ImportCsvColumn, string>,
): ParsedImportRow {
  return {
    rowNumber,
    raw,
    customerName: raw.customer_name.trim(),
    customerType: raw.customer_type.trim() || IMPORT_DEFAULTS.customerType,
    phoneCountryCode: raw.phone_country_code.trim() || IMPORT_DEFAULTS.phoneCountryCode,
    phone: raw.phone.trim() || null,
    wechatId: raw.wechat_id.trim() || null,
    email: raw.email.trim() || null,
    source: raw.source.trim(),
    sourceRemark: raw.source_remark.trim() || null,
    notes: raw.notes.trim() || null,
    salesStage: raw.sales_stage.trim() || IMPORT_DEFAULTS.salesStage,
  };
}

function validationCode(field: string): string {
  const codes: Record<string, string> = {
    customerName: "missing_customer_name",
    phone: "missing_contact",
    email: "invalid_email",
    source: "invalid_source",
    sourceRemark: "missing_source_remark",
    customerType: "invalid_customer_type",
    salesStage: "invalid_sales_stage",
  };
  return codes[field] ?? `invalid_${field}`;
}

function validationMessage(field: string, message: string): string {
  if (field === "phone" && message.includes("11 位")) {
    return message;
  }
  return message;
}

type DbCustomerMatch = {
  id: string;
  customerName: string;
  status: string;
  phone: string | null;
  wechatId: string | null;
  email: string | null;
};

async function loadExistingCustomers(
  phones: string[],
  wechatIds: string[],
  emails: string[],
): Promise<DbCustomerMatch[]> {
  const conditions = [];
  if (phones.length > 0) {
    conditions.push(inArray(schema.customers.phone, phones));
  }
  if (wechatIds.length > 0) {
    conditions.push(inArray(schema.customers.wechatId, wechatIds));
  }
  if (emails.length > 0) {
    conditions.push(inArray(schema.customers.email, emails));
  }
  if (conditions.length === 0) return [];

  const db = getDb();
  return db
    .select({
      id: schema.customers.id,
      customerName: schema.customers.customerName,
      status: schema.customers.status,
      phone: schema.customers.phone,
      wechatId: schema.customers.wechatId,
      email: schema.customers.email,
    })
    .from(schema.customers)
    .where(or(...conditions));
}

function findDbDuplicate(
  row: ParsedImportRow,
  existing: DbCustomerMatch[],
): { field: DuplicateField; customer: DbCustomerMatch } | null {
  const phone = row.phone?.trim() || null;
  const wechatId = row.wechatId?.trim() || null;
  const email = row.email?.trim().toLowerCase() || null;

  for (const customer of existing) {
    if (customer.status === "archived") continue;

    if (phone && customer.phone === phone) {
      return { field: "phone", customer };
    }
    if (wechatId && customer.wechatId === wechatId) {
      return { field: "wechatId", customer };
    }
    if (email && customer.email?.toLowerCase() === email) {
      return { field: "email", customer };
    }
  }
  return null;
}

function duplicateCode(field: DuplicateField, scope: "csv" | "db"): string {
  if (scope === "csv") {
    return `duplicate_${field}_csv`;
  }
  return `duplicate_${field}_db`;
}

function duplicateMessage(
  field: DuplicateField,
  scope: "csv" | "db",
  value: string,
  extra?: string,
): string {
  const label =
    field === "phone" ? "手机号" : field === "wechatId" ? "微信号" : "邮箱";
  if (scope === "csv") {
    return `CSV 内 ${label} 重复：${value}${extra ? `（${extra}）` : ""}`;
  }
  return `与已有客户 ${label} 重复：${value}${extra ? `（${extra}）` : ""}`;
}

export async function precheckCustomerImport(
  csvText: string,
  _user: User,
): Promise<Omit<PrecheckResult, "jobId">> {
  const { rows: csvRows, parseErrors } = parseCustomerImportCsv(csvText);
  const errors: ImportIssue[] = [];
  const warnings: ImportIssue[] = [];

  for (const pe of parseErrors) {
    errors.push({
      rowNumber: pe.rowNumber,
      field: "csv",
      code: "csv_parse_error",
      message: pe.message,
    });
  }

  const parsedRows: ParsedImportRow[] = [];
  let dataRowIndex = 0;

  for (const raw of csvRows) {
    dataRowIndex++;
    const rowNumber = dataRowIndex + 1;

    if (isEmptyImportRow(raw)) {
      errors.push({
        rowNumber,
        field: "row",
        code: "empty_row",
        message: "空行或无效行",
      });
      continue;
    }

    parsedRows.push(toParsedRow(rowNumber, raw));
  }

  const phonesInCsv = new Map<string, number[]>();
  const wechatsInCsv = new Map<string, number[]>();
  const emailsInCsv = new Map<string, number[]>();

  for (const row of parsedRows) {
    if (row.phone) {
      const list = phonesInCsv.get(row.phone) ?? [];
      list.push(row.rowNumber);
      phonesInCsv.set(row.phone, list);
    }
    if (row.wechatId) {
      const list = wechatsInCsv.get(row.wechatId) ?? [];
      list.push(row.rowNumber);
      wechatsInCsv.set(row.wechatId, list);
    }
    if (row.email) {
      const normalized = row.email.toLowerCase();
      const list = emailsInCsv.get(normalized) ?? [];
      list.push(row.rowNumber);
      emailsInCsv.set(normalized, list);
    }
  }

  const phonesToCheck = [...phonesInCsv.keys()];
  const wechatsToCheck = [...wechatsInCsv.keys()];
  const emailsToCheck = [...emailsInCsv.keys()];
  const existingCustomers = await loadExistingCustomers(
    phonesToCheck,
    wechatsToCheck,
    emailsToCheck,
  );

  const rowErrors = new Map<number, ImportIssue[]>();
  const rowWarnings = new Map<number, ImportIssue[]>();

  function addError(issue: ImportIssue) {
    const list = rowErrors.get(issue.rowNumber) ?? [];
    list.push(issue);
    rowErrors.set(issue.rowNumber, list);
  }

  function addWarning(issue: ImportIssue) {
    const list = rowWarnings.get(issue.rowNumber) ?? [];
    list.push(issue);
    rowWarnings.set(issue.rowNumber, list);
  }

  for (const row of parsedRows) {
    const input = {
      customerName: row.customerName,
      customerType: row.customerType,
      phoneCountryCode: row.phoneCountryCode,
      phone: row.phone,
      wechatId: row.wechatId,
      email: row.email,
      source: row.source,
      sourceRemark: row.sourceRemark,
      notes: row.notes,
      salesStage: row.salesStage,
    };

    const fieldErrors = validateCustomerInput(input);
    for (const fe of fieldErrors) {
      const csvField =
        Object.entries(CSV_FIELD_TO_INPUT).find(([, v]) => v === fe.field)?.[0] ??
        fe.field;
      let code = validationCode(fe.field);
      if (fe.field === "phone" && fe.message.includes("11 位")) {
        code = "invalid_phone";
      }
      if (fe.field === "phone" && fe.message.includes("至少")) {
        code = "missing_contact";
      }
      addError({
        rowNumber: row.rowNumber,
        field: csvField,
        code,
        message: validationMessage(fe.field, fe.message),
        value: String(row.raw[csvField as ImportCsvColumn] ?? ""),
      });
    }

    if (!row.raw.customer_type.trim()) {
      addWarning({
        rowNumber: row.rowNumber,
        field: "customer_type",
        code: "default_customer_type",
        message: IMPORT_DEFAULT_WARNINGS.customerType,
      });
    }
    if (!row.raw.sales_stage.trim()) {
      addWarning({
        rowNumber: row.rowNumber,
        field: "sales_stage",
        code: "default_sales_stage",
        message: IMPORT_DEFAULT_WARNINGS.salesStage,
      });
    }
    if (!row.raw.phone_country_code.trim()) {
      addWarning({
        rowNumber: row.rowNumber,
        field: "phone_country_code",
        code: "default_phone_country_code",
        message: IMPORT_DEFAULT_WARNINGS.phoneCountryCode,
      });
    }

    if (row.phone && (phonesInCsv.get(row.phone)?.length ?? 0) > 1) {
      addError({
        rowNumber: row.rowNumber,
        field: "phone",
        code: duplicateCode("phone", "csv"),
        message: duplicateMessage("phone", "csv", row.phone),
        value: row.phone,
      });
    }
    if (row.wechatId && (wechatsInCsv.get(row.wechatId)?.length ?? 0) > 1) {
      addError({
        rowNumber: row.rowNumber,
        field: "wechat_id",
        code: duplicateCode("wechatId", "csv"),
        message: duplicateMessage("wechatId", "csv", row.wechatId),
        value: row.wechatId,
      });
    }
    if (row.email) {
      const normalized = row.email.toLowerCase();
      if ((emailsInCsv.get(normalized)?.length ?? 0) > 1) {
        addError({
          rowNumber: row.rowNumber,
          field: "email",
          code: duplicateCode("email", "csv"),
          message: duplicateMessage("email", "csv", row.email),
          value: row.email,
        });
      }
    }

    const dbDup = findDbDuplicate(row, existingCustomers);
    if (dbDup) {
      const csvField =
        dbDup.field === "wechatId"
          ? "wechat_id"
          : dbDup.field;
      const value =
        dbDup.field === "phone"
          ? row.phone!
          : dbDup.field === "wechatId"
            ? row.wechatId!
            : row.email!;
      addError({
        rowNumber: row.rowNumber,
        field: csvField,
        code: duplicateCode(dbDup.field, "db"),
        message: duplicateMessage(
          dbDup.field,
          "db",
          value,
          `客户：${dbDup.customer.customerName}（${dbDup.customer.id}）`,
        ),
        value,
      });
    }
  }

  for (const list of rowErrors.values()) errors.push(...list);
  for (const list of rowWarnings.values()) warnings.push(...list);

  const errorRowNumbers = new Set(errors.map((e) => e.rowNumber));

  const duplicateRows = new Set(
    errors
      .filter((e) => e.code.startsWith("duplicate_"))
      .map((e) => e.rowNumber),
  ).size;

  /** Rows without errors are importable; warnings do not reduce this count. */
  const validRows = parsedRows.filter(
    (r) => !errorRowNumbers.has(r.rowNumber),
  ).length;

  const invalidRows = errorRowNumbers.size;

  const previewRows: ImportPreviewRow[] = parsedRows.slice(0, 50).map((row) => {
    const hasError = errorRowNumbers.has(row.rowNumber);
    const hasWarning = (rowWarnings.get(row.rowNumber)?.length ?? 0) > 0;
    return {
      rowNumber: row.rowNumber,
      customerName: row.customerName,
      phone: row.phone,
      wechatId: row.wechatId,
      email: row.email,
      source: row.source,
      status: hasError ? "error" : hasWarning ? "warning" : "valid",
    };
  });

  return {
    totalRows: parsedRows.length,
    validRows,
    invalidRows,
    duplicateRows,
    errors,
    warnings,
    previewRows,
    rows: parsedRows,
  };
}
