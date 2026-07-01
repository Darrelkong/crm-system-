import { and, desc, eq, gte, lt, lte, or } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { schema } from "@/lib/db";
import type { AuditLogListFilters, AuditLogListItem } from "@/lib/audit/types";

export const AUDIT_LOG_DEFAULT_LIMIT = 50;
export const AUDIT_LOG_MAX_LIMIT = 100;

type AuditLogCursor = {
  createdAt: string;
  id: string;
};

export function parseAuditMetadata(
  raw: string | null,
): Record<string, unknown> | null {
  if (!raw) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

export function resolveAuditLogLimit(limit?: number): number {
  if (limit == null) {
    return AUDIT_LOG_DEFAULT_LIMIT;
  }
  if (!Number.isFinite(limit) || limit < 1) {
    return AUDIT_LOG_DEFAULT_LIMIT;
  }
  return Math.min(Math.floor(limit), AUDIT_LOG_MAX_LIMIT);
}

export function parseAuditLogLimitParam(raw: string | null): number {
  if (raw == null || raw.trim() === "") {
    return AUDIT_LOG_DEFAULT_LIMIT;
  }
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) {
    return AUDIT_LOG_DEFAULT_LIMIT;
  }
  return resolveAuditLogLimit(parsed);
}

export function encodeAuditLogCursor(createdAt: string, id: string): string {
  return Buffer.from(JSON.stringify({ createdAt, id }), "utf8").toString(
    "base64url",
  );
}

export function decodeAuditLogCursor(cursor: string): AuditLogCursor | null {
  try {
    const decoded = Buffer.from(cursor, "base64url").toString("utf8");
    const parsed: unknown = JSON.parse(decoded);
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      "createdAt" in parsed &&
      "id" in parsed &&
      typeof (parsed as AuditLogCursor).createdAt === "string" &&
      typeof (parsed as AuditLogCursor).id === "string"
    ) {
      return parsed as AuditLogCursor;
    }
    return null;
  } catch {
    return null;
  }
}

function buildAuditLogFilterConditions(filters: AuditLogListFilters) {
  const conditions = [];

  if (filters.action) {
    conditions.push(eq(schema.auditLogs.action, filters.action));
  }
  if (filters.entityType) {
    conditions.push(eq(schema.auditLogs.entityType, filters.entityType));
  }
  if (filters.entityId) {
    conditions.push(eq(schema.auditLogs.entityId, filters.entityId));
  }
  if (filters.userId) {
    conditions.push(eq(schema.auditLogs.userId, filters.userId));
  }
  if (filters.dateFrom) {
    conditions.push(gte(schema.auditLogs.createdAt, filters.dateFrom));
  }
  if (filters.dateTo) {
    conditions.push(lte(schema.auditLogs.createdAt, filters.dateTo));
  }
  if (filters.cursor) {
    const decoded = decodeAuditLogCursor(filters.cursor);
    if (!decoded) {
      throw new InvalidAuditLogCursorError();
    }
    conditions.push(
      or(
        lt(schema.auditLogs.createdAt, decoded.createdAt),
        and(
          eq(schema.auditLogs.createdAt, decoded.createdAt),
          lt(schema.auditLogs.id, decoded.id),
        ),
      )!,
    );
  }

  return conditions;
}

export class InvalidAuditLogCursorError extends Error {
  constructor() {
    super("Invalid audit log cursor");
    this.name = "InvalidAuditLogCursorError";
  }
}

export async function listAuditLogsForAdmin(
  db: Database,
  filters: AuditLogListFilters = {},
): Promise<{ items: AuditLogListItem[]; nextCursor: string | null }> {
  const limit = resolveAuditLogLimit(filters.limit);
  const conditions = buildAuditLogFilterConditions(filters);

  const query = db
    .select({
      id: schema.auditLogs.id,
      userId: schema.auditLogs.userId,
      userName: schema.users.displayName,
      userEmail: schema.users.email,
      action: schema.auditLogs.action,
      entityType: schema.auditLogs.entityType,
      entityId: schema.auditLogs.entityId,
      ipAddress: schema.auditLogs.ipAddress,
      userAgent: schema.auditLogs.userAgent,
      metadata: schema.auditLogs.metadata,
      createdAt: schema.auditLogs.createdAt,
    })
    .from(schema.auditLogs)
    .leftJoin(schema.users, eq(schema.auditLogs.userId, schema.users.id))
    .orderBy(desc(schema.auditLogs.createdAt), desc(schema.auditLogs.id))
    .limit(limit + 1);

  const rows =
    conditions.length > 0 ? await query.where(and(...conditions)) : await query;

  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;

  const items: AuditLogListItem[] = pageRows.map((row) => ({
    id: row.id,
    userId: row.userId,
    userName: row.userName ?? null,
    userEmail: row.userEmail ?? null,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    ipAddress: row.ipAddress,
    userAgent: row.userAgent,
    metadata: parseAuditMetadata(row.metadata),
    createdAt: row.createdAt,
  }));

  const last = pageRows.at(-1);
  const nextCursor =
    hasMore && last
      ? encodeAuditLogCursor(last.createdAt, last.id)
      : null;

  return { items, nextCursor };
}

/** @internal Test helper to assert ordering without fetching full rows. */
export async function listAuditLogCreatedAtKeys(
  db: Database,
  filters: AuditLogListFilters = {},
): Promise<Array<{ createdAt: string; id: string }>> {
  const limit = resolveAuditLogLimit(filters.limit);
  const conditions = buildAuditLogFilterConditions(filters);

  const query = db
    .select({
      createdAt: schema.auditLogs.createdAt,
      id: schema.auditLogs.id,
    })
    .from(schema.auditLogs)
    .orderBy(desc(schema.auditLogs.createdAt), desc(schema.auditLogs.id))
    .limit(limit);

  const rows =
    conditions.length > 0 ? await query.where(and(...conditions)) : await query;

  return rows;
}
