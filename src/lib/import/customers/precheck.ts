import { isNotNull, or, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { validateCustomerInput } from "@/lib/customers/validation";
import type { DuplicateField } from "@/lib/customers/duplicate-check";
import {
  normalizeCustomerEmail,
  normalizeCustomerPhone,
  normalizeCustomerWechat,
} from "@/lib/customers/contact-normalization";
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
  requested_project_name: "requestedProjectName",
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
    phoneCountryCode:
      raw.phone_country_code.trim() || IMPORT_DEFAULTS.phoneCountryCode,
    phone: raw.phone.trim() || null,
    wechatId: raw.wechat_id.trim() || null,
    email: raw.email.trim() || null,
    source: raw.source.trim(),
    sourceRemark: raw.source_remark.trim() || null,
    requestedProjectName: raw.requested_project_name.trim() || null,
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
  phoneCountryCode: string;
  phone: string | null;
  wechatId: string | null;
  email: string | null;
};

type DbContactMatch = {
  customerId: string;
  phone: string | null;
  wechatId: string | null;
  email: string | null;
};

/**
 * Load candidate customers + secondary contacts for import duplicate checks.
 * Includes archived rows. Matching uses normalize helpers.
 */
async function loadExistingContactUniverse(options: {
  hasPhone: boolean;
  hasWechat: boolean;
  hasEmail: boolean;
}): Promise<{ customers: DbCustomerMatch[]; contacts: DbContactMatch[] }> {
  const db = getDb();
  const customerConditions = [];
  if (options.hasPhone) {
    customerConditions.push(isNotNull(schema.customers.phone));
  }
  if (options.hasWechat) {
    customerConditions.push(isNotNull(schema.customers.wechatId));
  }
  if (options.hasEmail) {
    customerConditions.push(isNotNull(schema.customers.email));
  }

  const customers: DbCustomerMatch[] =
    customerConditions.length === 0
      ? []
      : await db
          .select({
            id: schema.customers.id,
            customerName: schema.customers.customerName,
            status: schema.customers.status,
            phoneCountryCode: schema.customers.phoneCountryCode,
            phone: schema.customers.phone,
            wechatId: schema.customers.wechatId,
            email: schema.customers.email,
          })
          .from(schema.customers)
          .where(or(...customerConditions));

  const contactConditions = [];
  if (options.hasPhone) {
    contactConditions.push(isNotNull(schema.customerContacts.phone));
  }
  if (options.hasWechat) {
    contactConditions.push(isNotNull(schema.customerContacts.wechatId));
  }
  if (options.hasEmail) {
    contactConditions.push(isNotNull(schema.customerContacts.email));
  }

  const contacts: DbContactMatch[] =
    contactConditions.length === 0
      ? []
      : await db
          .select({
            customerId: schema.customerContacts.customerId,
            phone: schema.customerContacts.phone,
            wechatId: schema.customerContacts.wechatId,
            email: schema.customerContacts.email,
          })
          .from(schema.customerContacts)
          .where(or(...contactConditions));

  const missingIds = [
    ...new Set(
      contacts
        .map((c) => c.customerId)
        .filter((id) => !customers.some((row) => row.id === id)),
    ),
  ];
  if (missingIds.length > 0) {
    const extras = await db
      .select({
        id: schema.customers.id,
        customerName: schema.customers.customerName,
        status: schema.customers.status,
        phoneCountryCode: schema.customers.phoneCountryCode,
        phone: schema.customers.phone,
        wechatId: schema.customers.wechatId,
        email: schema.customers.email,
      })
      .from(schema.customers)
      .where(or(...missingIds.map((id) => eq(schema.customers.id, id))));
    customers.push(...extras);
  }

  return { customers, contacts };
}

function findDbDuplicate(
  row: ParsedImportRow,
  existingCustomers: DbCustomerMatch[],
  existingContacts: DbContactMatch[],
): { field: DuplicateField; customer: DbCustomerMatch } | null {
  const phoneId = normalizeCustomerPhone(row.phoneCountryCode, row.phone);
  const wechatId = normalizeCustomerWechat(row.wechatId);
  const email = normalizeCustomerEmail(row.email);

  for (const customer of existingCustomers) {
    if (
      phoneId &&
      normalizeCustomerPhone(customer.phoneCountryCode, customer.phone) ===
        phoneId
    ) {
      return { field: "phone", customer };
    }
    if (wechatId && normalizeCustomerWechat(customer.wechatId) === wechatId) {
      return { field: "wechatId", customer };
    }
    if (email && normalizeCustomerEmail(customer.email) === email) {
      return { field: "email", customer };
    }
  }

  const byId = new Map(existingCustomers.map((c) => [c.id, c]));
  for (const contact of existingContacts) {
    const customer = byId.get(contact.customerId);
    if (!customer) continue;
    if (
      phoneId &&
      normalizeCustomerPhone(customer.phoneCountryCode, contact.phone) ===
        phoneId
    ) {
      return { field: "phone", customer };
    }
    if (wechatId && normalizeCustomerWechat(contact.wechatId) === wechatId) {
      return { field: "wechatId", customer };
    }
    if (email && normalizeCustomerEmail(contact.email) === email) {
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
    const phoneKey = normalizeCustomerPhone(row.phoneCountryCode, row.phone);
    if (phoneKey) {
      const list = phonesInCsv.get(phoneKey) ?? [];
      list.push(row.rowNumber);
      phonesInCsv.set(phoneKey, list);
    }
    const wechatKey = normalizeCustomerWechat(row.wechatId);
    if (wechatKey) {
      const list = wechatsInCsv.get(wechatKey) ?? [];
      list.push(row.rowNumber);
      wechatsInCsv.set(wechatKey, list);
    }
    const emailKey = normalizeCustomerEmail(row.email);
    if (emailKey) {
      const list = emailsInCsv.get(emailKey) ?? [];
      list.push(row.rowNumber);
      emailsInCsv.set(emailKey, list);
    }
  }

  const { customers: existingCustomers, contacts: existingContacts } =
    await loadExistingContactUniverse({
      hasPhone: phonesInCsv.size > 0,
      hasWechat: wechatsInCsv.size > 0,
      hasEmail: emailsInCsv.size > 0,
    });

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
      requestedProjectName: row.requestedProjectName,
      notes: row.notes,
      salesStage: row.salesStage,
    };

    const fieldErrors = validateCustomerInput(input, {
      requireSalesStage: true,
    });
    for (const fe of fieldErrors) {
      const csvField =
        Object.entries(CSV_FIELD_TO_INPUT).find(([, v]) => v === fe.field)?.[0] ??
        fe.field;
      addError({
        rowNumber: row.rowNumber,
        field: csvField,
        code: validationCode(fe.field),
        message: validationMessage(fe.field, fe.message),
        value: row.raw[csvField as ImportCsvColumn] ?? undefined,
      });
    }

    if (!row.raw.phone_country_code.trim() && row.phone) {
      addWarning({
        rowNumber: row.rowNumber,
        field: "phone_country_code",
        code: "default_phone_country_code",
        message: IMPORT_DEFAULT_WARNINGS.phoneCountryCode,
      });
    }

    const phoneKey = normalizeCustomerPhone(row.phoneCountryCode, row.phone);
    if (phoneKey && (phonesInCsv.get(phoneKey)?.length ?? 0) > 1) {
      addError({
        rowNumber: row.rowNumber,
        field: "phone",
        code: duplicateCode("phone", "csv"),
        message: duplicateMessage("phone", "csv", row.phone ?? phoneKey),
        value: row.phone ?? undefined,
      });
    }

    const wechatKey = normalizeCustomerWechat(row.wechatId);
    if (wechatKey && (wechatsInCsv.get(wechatKey)?.length ?? 0) > 1) {
      addError({
        rowNumber: row.rowNumber,
        field: "wechat_id",
        code: duplicateCode("wechatId", "csv"),
        message: duplicateMessage(
          "wechatId",
          "csv",
          row.wechatId ?? wechatKey,
        ),
        value: row.wechatId ?? undefined,
      });
    }

    const emailKey = normalizeCustomerEmail(row.email);
    if (emailKey && (emailsInCsv.get(emailKey)?.length ?? 0) > 1) {
      addError({
        rowNumber: row.rowNumber,
        field: "email",
        code: duplicateCode("email", "csv"),
        message: duplicateMessage("email", "csv", row.email ?? emailKey),
        value: row.email ?? undefined,
      });
    }

    const dbDup = findDbDuplicate(row, existingCustomers, existingContacts);
    if (dbDup) {
      const csvField = dbDup.field === "wechatId" ? "wechat_id" : dbDup.field;
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
