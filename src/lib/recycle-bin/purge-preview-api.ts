import type { Database } from "@/lib/db";
import { AuthError } from "@/lib/permissions/auth";
import {
  RECYCLE_BIN_PURGE_BATCH_SIZE,
} from "@/lib/recycle-bin/constants";
import { previewExpiredRecycleBinCustomers } from "@/lib/recycle-bin/service";
import type { ExpiredRecycleBinPreviewResult } from "@/lib/recycle-bin/types";
import type { User } from "../../../drizzle/schema/users";

export const PURGE_PREVIEW_DEFAULT_LIMIT = RECYCLE_BIN_PURGE_BATCH_SIZE;
export const PURGE_PREVIEW_MAX_LIMIT = 100;

export type RecycleBinPurgePreviewResponse = {
  ok: true;
} & ExpiredRecycleBinPreviewResult;

export function resolvePurgePreviewBatchSize(limit?: number): number {
  if (limit == null) {
    return PURGE_PREVIEW_DEFAULT_LIMIT;
  }
  if (!Number.isFinite(limit) || limit < 1) {
    return PURGE_PREVIEW_DEFAULT_LIMIT;
  }
  return Math.min(Math.floor(limit), PURGE_PREVIEW_MAX_LIMIT);
}

export function parsePurgePreviewLimitParam(raw: string | null): number {
  if (raw == null || raw.trim() === "") {
    return PURGE_PREVIEW_DEFAULT_LIMIT;
  }
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) {
    return PURGE_PREVIEW_DEFAULT_LIMIT;
  }
  return resolvePurgePreviewBatchSize(parsed);
}

export async function getRecycleBinPurgePreviewForAdmin(
  actor: Pick<User, "role">,
  db: Database,
  options?: { limit?: number; now?: Date },
): Promise<RecycleBinPurgePreviewResponse> {
  if (actor.role !== "admin") {
    throw new AuthError(
      403,
      "需要管理员权限",
      "permission.denied.admin_required",
    );
  }

  const batchSize = resolvePurgePreviewBatchSize(options?.limit);
  const preview = await previewExpiredRecycleBinCustomers(db, {
    batchSize,
    now: options?.now,
  });

  return {
    ok: true,
    ...preview,
  };
}
