export type ImportIssue = {
  rowNumber: number;
  field: string;
  code: string;
  message: string;
  value?: string;
};

export type ImportPreviewRow = {
  rowNumber: number;
  customerName: string;
  phone?: string | null;
  wechatId?: string | null;
  email?: string | null;
  source: string;
  status: "valid" | "error" | "warning";
};

export type ParsedImportRow = {
  rowNumber: number;
  raw: Record<string, string>;
  customerName: string;
  customerType: string;
  phoneCountryCode: string;
  phone: string | null;
  wechatId: string | null;
  email: string | null;
  source: string;
  sourceRemark: string | null;
  requestedProjectName: string | null;
  notes: string | null;
  salesStage: string;
};

export type PrecheckResult = {
  jobId: string;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  duplicateRows: number;
  errors: ImportIssue[];
  warnings: ImportIssue[];
  previewRows: ImportPreviewRow[];
  rows: ParsedImportRow[];
};

export type CommitResult = {
  jobId: string;
  importedCount: number;
  skippedCount: number;
  failedCount: number;
  createdCustomerIds: string[];
  errors: ImportIssue[];
  warnings: ImportIssue[];
};
