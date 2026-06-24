import type { CustomerExportRow } from "@/lib/export/customers/queries";

const UTF8_BOM = "\uFEFF";

export function escapeCsvCell(value: string | null | undefined): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function buildCustomersExportCsv(
  rows: CustomerExportRow[],
  fields: string[],
): string {
  const header = fields.join(",");
  const lines = rows.map((row) =>
    fields
      .map((field) =>
        escapeCsvCell(row[field as keyof CustomerExportRow] ?? ""),
      )
      .join(","),
  );
  return `${UTF8_BOM}${header}\n${lines.join("\n")}\n`;
}
