import { ne } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { schema } from "@/lib/db";
import {
  BACKUP_EXCLUDED_FIELDS,
  BACKUP_TABLE_NAMES,
  type BackupTableName,
} from "@/lib/backup/constants";

type Row = Record<string, unknown>;

function camelToSnake(key: string): string {
  return key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

function toSnakeRow(row: Row, excludeFields: readonly string[] = []): Row {
  const out: Row = {};
  for (const [key, value] of Object.entries(row)) {
    const snake = camelToSnake(key);
    if (excludeFields.includes(snake)) continue;
    out[snake] = value;
  }
  return out;
}

export type BackupTableData = Record<BackupTableName, Row[]>;

export async function collectBackupTableData(
  db: Database,
  excludeBackupJobId?: string,
): Promise<BackupTableData> {
  const users = await db
    .select({
      id: schema.users.id,
      email: schema.users.email,
      displayName: schema.users.displayName,
      role: schema.users.role,
      isActive: schema.users.isActive,
      failedLoginAttempts: schema.users.failedLoginAttempts,
      lockedUntil: schema.users.lockedUntil,
      createdAt: schema.users.createdAt,
      updatedAt: schema.users.updatedAt,
    })
    .from(schema.users);

  const customers = await db.select().from(schema.customers);
  const customerContacts = await db.select().from(schema.customerContacts);
  const customerAssignees = await db.select().from(schema.customerAssignees);
  const customerTags = await db.select().from(schema.customerTags);
  const customerAiInsights = await db.select().from(schema.customerAiInsights);
  const followUps = await db.select().from(schema.followUps);
  const tasks = await db.select().from(schema.tasks);
  const auditLogs = await db.select().from(schema.auditLogs);
  const loginLogs = await db.select().from(schema.loginLogs);
  const loginIpEmailRestrictions = await db
    .select()
    .from(schema.loginIpEmailRestrictions);
  const systemSettings = await db.select().from(schema.systemSettings);
  const approvals = await db.select().from(schema.approvals);
  const notifications = await db.select().from(schema.notifications);
  const announcements = await db.select().from(schema.announcements);
  const importJobs = await db.select().from(schema.importJobs);
  const exportJobs = await db.select().from(schema.exportJobs);
  const fieldChangeLogs = await db.select().from(schema.fieldChangeLogs);
  const reclamationWarningLogs = await db
    .select()
    .from(schema.reclamationWarningLogs);
  const customerCodeCounter = await db.select().from(schema.customerCodeCounter);

  const backupJobsQuery = db.select().from(schema.backupJobs);
  const backupJobs = excludeBackupJobId
    ? await backupJobsQuery.where(
        ne(schema.backupJobs.id, excludeBackupJobId),
      )
    : await backupJobsQuery;

  const raw: Record<BackupTableName, Row[]> = {
    users: users.map((r) => toSnakeRow(r as Row, BACKUP_EXCLUDED_FIELDS.users)),
    customers: customers.map((r) => toSnakeRow(r as Row)),
    customer_contacts: customerContacts.map((r) => toSnakeRow(r as Row)),
    customer_assignees: customerAssignees.map((r) => toSnakeRow(r as Row)),
    customer_tags: customerTags.map((r) => toSnakeRow(r as Row)),
    customer_ai_insights: customerAiInsights.map((r) => toSnakeRow(r as Row)),
    follow_ups: followUps.map((r) => toSnakeRow(r as Row)),
    tasks: tasks.map((r) => toSnakeRow(r as Row)),
    audit_logs: auditLogs.map((r) => toSnakeRow(r as Row)),
    login_logs: loginLogs.map((r) => toSnakeRow(r as Row)),
    login_ip_email_restrictions: loginIpEmailRestrictions.map((r) =>
      toSnakeRow(r as Row),
    ),
    system_settings: systemSettings.map((r) => toSnakeRow(r as Row)),
    approvals: approvals.map((r) => toSnakeRow(r as Row)),
    notifications: notifications.map((r) => toSnakeRow(r as Row)),
    announcements: announcements.map((r) => toSnakeRow(r as Row)),
    import_jobs: importJobs.map((r) => toSnakeRow(r as Row)),
    export_jobs: exportJobs.map((r) => toSnakeRow(r as Row)),
    field_change_logs: fieldChangeLogs.map((r) => toSnakeRow(r as Row)),
    reclamation_warning_logs: reclamationWarningLogs.map((r) =>
      toSnakeRow(r as Row),
    ),
    customer_code_counter: customerCodeCounter.map((r) => toSnakeRow(r as Row)),
    backup_jobs: backupJobs.map((r) => toSnakeRow(r as Row)),
  };

  for (const name of BACKUP_TABLE_NAMES) {
    if (!raw[name]) {
      raw[name] = [];
    }
  }

  return raw;
}

export function countBackupRecords(tables: BackupTableData): {
  tableCount: number;
  recordCount: number;
} {
  let recordCount = 0;
  for (const name of BACKUP_TABLE_NAMES) {
    recordCount += tables[name]?.length ?? 0;
  }
  return { tableCount: BACKUP_TABLE_NAMES.length, recordCount };
}
