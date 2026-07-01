import type { Database } from "@/lib/db";
import { AuthError } from "@/lib/permissions/auth";
import {
  InvalidAuditLogCursorError,
  listAuditLogsForAdmin,
  parseAuditLogLimitParam,
} from "@/lib/audit/queries";
import type { AuditLogListFilters, AuditLogListResponse } from "@/lib/audit/types";
import type { User } from "../../../drizzle/schema/users";

function readOptionalParam(url: URL, key: string): string | undefined {
  const value = url.searchParams.get(key);
  if (value == null || value.trim() === "") {
    return undefined;
  }
  return value.trim();
}

export function parseAuditLogListParams(url: URL): AuditLogListFilters {
  return {
    action: readOptionalParam(url, "action"),
    entityType: readOptionalParam(url, "entityType"),
    entityId: readOptionalParam(url, "entityId"),
    userId: readOptionalParam(url, "userId"),
    dateFrom: readOptionalParam(url, "dateFrom"),
    dateTo: readOptionalParam(url, "dateTo"),
    limit: parseAuditLogLimitParam(url.searchParams.get("limit")),
    cursor: readOptionalParam(url, "cursor"),
  };
}

export async function getAuditLogsForAdmin(
  actor: Pick<User, "role">,
  db: Database,
  filters: AuditLogListFilters = {},
): Promise<AuditLogListResponse> {
  if (actor.role !== "admin") {
    throw new AuthError(
      403,
      "需要管理员权限",
      "permission.denied.admin_required",
    );
  }

  try {
    const result = await listAuditLogsForAdmin(db, filters);
    return {
      ok: true,
      items: result.items,
      nextCursor: result.nextCursor,
    };
  } catch (error) {
    if (error instanceof InvalidAuditLogCursorError) {
      throw new AuthError(400, "无效的分页游标", "audit.invalid_cursor");
    }
    throw error;
  }
}
