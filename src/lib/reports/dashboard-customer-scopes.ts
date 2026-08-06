import { and, eq, inArray, isNotNull, isNull, lt, type SQL } from "drizzle-orm";
import { schema } from "@/lib/db";
import {
  normalCustomerListStatusWhere,
  ownedNormalCustomerListWhere,
} from "@/lib/customers/customer-list-filters";
import { validInternalCustomerOwnerExistsSql } from "@/lib/customers/valid-internal-customer-owner";

/**
 * Staff Dashboard「我的客户」口径（Phase 5A `getStaffMetrics`）。
 * Owner 私有客户、排除公共池/归档、status = active。
 */
export function staffMyActiveCustomerWhere(userId: string): SQL {
  return and(
    ownedNormalCustomerListWhere(userId),
    eq(schema.customers.status, "active"),
  )!;
}

/**
 * Staff Dashboard 逾期跟进口径（Phase 5A）。
 * `nextFollowUpAt < now`；等于 now 不计入。
 */
export function staffOverdueFollowUpWhere(
  userId: string,
  nowIso: string,
): SQL {
  return and(
    staffMyActiveCustomerWhere(userId),
    isNotNull(schema.customers.nextFollowUpAt),
    lt(schema.customers.nextFollowUpAt, nowIso),
  )!;
}

/**
 * Admin 团队私有活跃客户（Phase 5A `teamActiveScope`）。
 * 含 Staff 与 Admin owner；排除公共池与归档。
 * 注意：此条件不校验 owner 用户有效性，供 Phase 5A 逾期等既有口径复用。
 */
export function adminPrivateActiveCustomerWhere(): SQL {
  return and(
    normalCustomerListStatusWhere(),
    isNotNull(schema.customers.ownerId),
    eq(schema.customers.status, "active"),
  )!;
}

/**
 * Admin Dashboard 团队逾期跟进口径（Phase 5A `getAdminMetrics`）。
 */
export function adminTeamOverdueFollowUpWhere(nowIso: string): SQL {
  return and(
    adminPrivateActiveCustomerWhere(),
    isNotNull(schema.customers.nextFollowUpAt),
    lt(schema.customers.nextFollowUpAt, nowIso),
  )!;
}

/**
 * Admin 阶段分布：合法内部负责人持有的私有活跃客户。
 * 排除公共池、归档、软删除客户，以及无效／软删除／非内部 owner。
 */
export function adminStageDistributionWhere(): SQL {
  return and(
    adminPrivateActiveCustomerWhere(),
    isNull(schema.customers.deletedAt),
    validInternalCustomerOwnerExistsSql(),
  )!;
}

/** Batch: Staff 我的客户口径，限定在指定 owner 列表内。 */
export function staffOwnedActiveCustomersBatchWhere(ownerIds: string[]): SQL {
  return and(
    inArray(schema.customers.ownerId, ownerIds),
    normalCustomerListStatusWhere(),
    eq(schema.customers.status, "active"),
  )!;
}

/** Batch: Staff 逾期跟进口径，限定在指定 owner 列表内。 */
export function staffOverdueFollowUpBatchWhere(
  ownerIds: string[],
  nowIso: string,
): SQL {
  return and(
    staffOwnedActiveCustomersBatchWhere(ownerIds),
    isNotNull(schema.customers.nextFollowUpAt),
    lt(schema.customers.nextFollowUpAt, nowIso),
  )!;
}

/** Staff 阶段分布：与 Staff 我的客户范围一致，并排除软删除。 */
export function staffStageDistributionWhere(userId: string): SQL {
  return and(
    staffMyActiveCustomerWhere(userId),
    isNull(schema.customers.deletedAt),
  )!;
}
