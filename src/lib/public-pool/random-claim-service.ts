import { eq } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { getDb, schema } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit/audit-log";
import { getStaffClaimStatus } from "@/lib/public-pool/claim-limits";
import {
  RANDOM_CLAIM_CANDIDATE_BATCH_SIZE,
} from "@/lib/public-pool/constants";
import {
  getSelfReleaseClaimBlockState,
  listRandomClaimCandidatesForStaff,
} from "@/lib/public-pool/queries";
import {
  createRandomClaimAttemptOrder,
  type RandomIndexSource,
} from "@/lib/public-pool/random-claim";
import {
  buildStaffClaimGuardParams,
  claimCustomerFromPool,
} from "@/lib/public-pool/service";
import type { Customer } from "../../../drizzle/schema/customers";
import type { User } from "../../../drizzle/schema/users";

export type RandomClaimErrorCode =
  | "CLAIM_COOLDOWN"
  | "CLAIM_QUOTA_EXCEEDED"
  | "CLAIM_STATUS_UNAVAILABLE"
  | "PUBLIC_POOL_NO_ELIGIBLE_CUSTOMER"
  | "PUBLIC_POOL_CANDIDATE_SCAN_LIMIT"
  | "PUBLIC_POOL_RANDOM_CLAIM_CONFLICT"
  | "PUBLIC_POOL_CLIENT_ALREADY_CLAIMED";

export type ClaimRandomCustomerSuccess = {
  ok: true;
  customerId: string;
  customerCode: string | null;
  customerName: string;
  taskId: string;
};

export type ClaimRandomCustomerFailure = {
  ok: false;
  errorCode: RandomClaimErrorCode;
  httpStatus: number;
  error: string;
  staffBlockedReasonKey?: string | null;
  staffBlockedReasonParams?: Record<string, string>;
  scannedRows?: number;
};

export type ClaimRandomCustomerResult =
  | ClaimRandomCustomerSuccess
  | ClaimRandomCustomerFailure;

export type ClaimRandomCustomerFromPoolForStaffInput = {
  user: User;
  now?: Date;
  db?: Database;
  ipAddress?: string | null;
  userAgent?: string | null;
  /**
   * Internal test injection only. Never bind from HTTP request.
   */
  randomSource?: RandomIndexSource;
  /**
   * Internal test override for candidate scan cap. Never bind from HTTP request.
   */
  maxScanRows?: number;
  /**
   * Internal/test seam: called after eligibility precheck + candidate load,
   * immediately before each atomic Customer UPDATE attempt.
   * Default undefined — production behavior unchanged. Never bind from HTTP.
   */
  beforeAtomicClaimAttempt?: () => Promise<void>;
  /**
   * Internal/test seam: override cooldown hours for SQL guards and failure
   * classification (e.g. 0 to isolate quota races). Never bind from HTTP.
   * Does not change production defaults or system settings.
   */
  cooldownHoursOverride?: number;
};

function mapStaffStatusFailure(
  status: Awaited<ReturnType<typeof getStaffClaimStatus>>,
): ClaimRandomCustomerFailure {
  if (status.blockedReasonKey === "cooldown") {
    return {
      ok: false,
      errorCode: "CLAIM_COOLDOWN",
      httpStatus: 403,
      error: "领取冷却中",
      staffBlockedReasonKey: status.blockedReasonKey,
      staffBlockedReasonParams: status.blockedReasonParams,
    };
  }
  if (status.blockedReasonKey === "quotaExceeded") {
    return {
      ok: false,
      errorCode: "CLAIM_QUOTA_EXCEEDED",
      httpStatus: 429,
      error: "领取配额已用完",
      staffBlockedReasonKey: status.blockedReasonKey,
      staffBlockedReasonParams: status.blockedReasonParams,
    };
  }
  return {
    ok: false,
    errorCode: "CLAIM_STATUS_UNAVAILABLE",
    httpStatus: 403,
    error: "无法领取客户",
    staffBlockedReasonKey: status.blockedReasonKey,
    staffBlockedReasonParams: status.blockedReasonParams,
  };
}

async function loadCustomerForClaim(
  database: Database,
  customerId: string,
): Promise<Customer | null> {
  const rows = await database
    .select()
    .from(schema.customers)
    .where(eq(schema.customers.id, customerId))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Staff-only random claim from the oldest eligible public-pool batch.
 * Uses atomic staff guards on Customer UPDATE for same-staff concurrency.
 */
export async function claimRandomCustomerFromPoolForStaff(
  input: ClaimRandomCustomerFromPoolForStaffInput,
): Promise<ClaimRandomCustomerResult> {
  if (input.user.role !== "staff") {
    return {
      ok: false,
      errorCode: "CLAIM_STATUS_UNAVAILABLE",
      httpStatus: 403,
      error: "仅员工可随机领取",
    };
  }

  const database = input.db ?? getDb();
  const now = input.now ?? new Date();
  const audit = {
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
  };

  const staffStatus = await getStaffClaimStatus(input.user.id, now, database);
  if (input.cooldownHoursOverride === 0) {
    // Test seam: treat cooldown as disabled so quota races are not masked.
    if (staffStatus.claimedInLast7Days >= staffStatus.quotaLimit) {
      return {
        ok: false,
        errorCode: "CLAIM_QUOTA_EXCEEDED",
        httpStatus: 429,
        error: "领取配额已用完",
        staffBlockedReasonKey: "quotaExceeded",
        staffBlockedReasonParams: staffStatus.blockedReasonParams,
      };
    }
  } else if (!staffStatus.canClaimNow) {
    return mapStaffStatusFailure(staffStatus);
  }

  const scan = await listRandomClaimCandidatesForStaff({
    userId: input.user.id,
    now,
    db: database,
    maxScanRows: input.maxScanRows,
  });

  if (scan.candidates.length === 0) {
    if (scan.scanLimitReached) {
      await writeAuditLog({
        userId: input.user.id,
        action: "customer.claim_failed.candidate_scan_limit",
        entityType: "customer",
        entityId: null,
        ipAddress: audit.ipAddress,
        userAgent: audit.userAgent,
        metadata: {
          scannedRows: scan.scannedRows,
          scanLimitReached: true,
        },
      });
      return {
        ok: false,
        errorCode: "PUBLIC_POOL_CANDIDATE_SCAN_LIMIT",
        httpStatus: 503,
        error: "候选扫描达到上限，请稍后重试",
        scannedRows: scan.scannedRows,
      };
    }

    return {
      ok: false,
      errorCode: "PUBLIC_POOL_NO_ELIGIBLE_CUSTOMER",
      httpStatus: 404,
      error: "公共池暂无可领取客户",
      scannedRows: scan.scannedRows,
    };
  }

  const attemptOrder = createRandomClaimAttemptOrder(
    scan.candidates,
    input.randomSource,
  );
  const staffGuards = await buildStaffClaimGuardParams(
    input.user.id,
    now,
    database,
    input.cooldownHoursOverride === undefined
      ? undefined
      : { cooldownHoursOverride: input.cooldownHoursOverride },
  );

  for (const candidate of attemptOrder) {
    const customer = await loadCustomerForClaim(database, candidate.id);
    if (!customer || customer.status !== "public_pool" || customer.ownerId) {
      continue;
    }

    if (input.beforeAtomicClaimAttempt) {
      await input.beforeAtomicClaimAttempt();
    }

    const claimResult = await claimCustomerFromPool(customer, input.user, {
      ...audit,
      now,
      db: database,
      staffGuards,
      successAuditMetadata: {
        claimMethod: "random_oldest_batch",
        candidateBatchSize: RANDOM_CLAIM_CANDIDATE_BATCH_SIZE,
      },
    });

    if (claimResult.ok) {
      return {
        ok: true,
        customerId: customer.id,
        customerCode: customer.customerCode,
        customerName: customer.customerName,
        taskId: claimResult.taskId,
      };
    }

    // Re-classify user-level status first — do not try next candidate on quota/cooldown.
    const statusAfter = await getStaffClaimStatus(
      input.user.id,
      now,
      database,
    );
    if (input.cooldownHoursOverride === 0) {
      if (statusAfter.claimedInLast7Days >= statusAfter.quotaLimit) {
        return {
          ok: false,
          errorCode: "CLAIM_QUOTA_EXCEEDED",
          httpStatus: 429,
          error: "领取配额已用完",
          staffBlockedReasonKey: "quotaExceeded",
          staffBlockedReasonParams: statusAfter.blockedReasonParams,
        };
      }
    } else if (!statusAfter.canClaimNow) {
      return mapStaffStatusFailure(statusAfter);
    }

    const latest = await loadCustomerForClaim(database, candidate.id);
    if (
      !latest ||
      latest.status !== "public_pool" ||
      latest.ownerId != null
    ) {
      // Customer-level race: try next candidate.
      continue;
    }

    const selfRelease = getSelfReleaseClaimBlockState(
      latest,
      input.user.id,
      now,
    );
    if (selfRelease?.blocked) {
      continue;
    }

    return {
      ok: false,
      errorCode: "PUBLIC_POOL_RANDOM_CLAIM_CONFLICT",
      httpStatus: 409,
      error: "领取冲突，请稍后重试",
    };
  }

  return {
    ok: false,
    errorCode: "PUBLIC_POOL_NO_ELIGIBLE_CUSTOMER",
    httpStatus: 404,
    error: "公共池暂无可领取客户",
    scannedRows: scan.scannedRows,
  };
}
