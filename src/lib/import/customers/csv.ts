import {
  IMPORT_CSV_COLUMNS,
  type ImportCsvColumn,
} from "@/lib/import/customers/constants";

const CONTROL_CHAR_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F]/;

export type CsvParseResult = {
  headers: string[];
  rows: Record<ImportCsvColumn, string>[];
  parseErrors: { rowNumber: number; message: string }[];
};

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** Minimal RFC-style CSV row parser (quoted fields, escaped quotes). */
function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ",") {
      fields.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  fields.push(current);
  return fields;
}

function normalizeHeader(header: string): string {
  return header.trim().toLowerCase().replace(/\s+/g, "_");
}

export function parseCustomerImportCsv(csvText: string): CsvParseResult {
  const text = stripBom(csvText).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = text.split("\n").filter((line, index, arr) => {
    if (line.trim() !== "") return true;
    return index < arr.length - 1;
  });

  const parseErrors: { rowNumber: number; message: string }[] = [];
  if (lines.length === 0) {
    return { headers: [], rows: [], parseErrors: [{ rowNumber: 0, message: "CSV 内容为空" }] };
  }

  const headerFields = parseCsvLine(lines[0]!).map(normalizeHeader);
  const headers = headerFields.filter(Boolean);

  const unknownHeaders = headers.filter(
    (h) => !(IMPORT_CSV_COLUMNS as readonly string[]).includes(h),
  );
  if (unknownHeaders.length > 0) {
    parseErrors.push({
      rowNumber: 1,
      message: `未知列：${unknownHeaders.join(", ")}`,
    });
  }

  const rows: Record<ImportCsvColumn, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!;
    const rowNumber = i + 1;
    if (!line.trim()) continue;

    const values = parseCsvLine(line);
    const record = Object.fromEntries(
      IMPORT_CSV_COLUMNS.map((col) => [col, ""]),
    ) as Record<ImportCsvColumn, string>;

    for (let c = 0; c < headerFields.length; c++) {
      const key = headerFields[c];
      if (!key || !(IMPORT_CSV_COLUMNS as readonly string[]).includes(key)) {
        continue;
      }
      record[key as ImportCsvColumn] = (values[c] ?? "").trim();
    }

    for (const value of Object.values(record)) {
      if (value && CONTROL_CHAR_RE.test(value)) {
        parseErrors.push({
          rowNumber,
          message: "字段包含非法控制字符",
        });
        break;
      }
    }

    rows.push(record);
  }

  return { headers, rows, parseErrors };
}

export function isEmptyImportRow(row: Record<ImportCsvColumn, string>): boolean {
  return IMPORT_CSV_COLUMNS.every((col) => !row[col]?.trim());
}
