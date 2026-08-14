import { and, eq, isNull, ne, sql, type SQL } from "drizzle-orm";
import { schema, type Database } from "@/lib/db";
import type { Approval } from "../../../drizzle/schema/approvals";
import type { Customer } from "../../../drizzle/schema/customers";
import type { User } from "../../../drizzle/schema/users";
import { ApprovalError } from "@/lib/approvals/service";
import {
  buildAdminRemovePriorityFields,
  buildAdminSetPriorityFields,
  buildApprovalSetPriorityFields,
  PRIORITY_ERROR_CODES,
  type PriorityRequestType,
} from "./priority-customer";

export type PriorityApprovalSnapshot = {
  expectedIsPinned: boolean;
  expectedPinnedSource: string | null;
  expectedSalesStage: string;
};

export type PriorityAdminSnapshot = {
  isPinned: number;
  pinnedSource: string | null;
  pinnedAt: string | null;
  salesStage: string;
};

export function parsePriorityApprovalSnapshot(
  approval: Approval,
): PriorityApprovalSnapshot | null {
  if (!approval.payload) return null;
  try {
    const parsed = JSON.parse(approval.payload) as Record<string, unknown>;
    if (
      typeof parsed.expectedIsPinned !== "boolean" ||
      typeof parsed.expectedSalesStage !== "string"
    ) {
      return null;
    }
    return {
      expectedIsPinned: parsed.expectedIsPinned,
      expectedPinnedSource:
        typeof parsed.expectedPinnedSource === "string"
          ? parsed.expectedPinnedSource
          : null,
      expectedSalesStage: parsed.expectedSalesStage,
    };
  } catch {
    return null;
  }
}

export function toPriorityAdminSnapshot(
  customer: Pick<Customer, "isPinned" | "pinnedSource" | "pinnedAt" | "salesStage">,
): PriorityAdminSnapshot {
  return {
    isPinned: customer.isPinned,
    pinnedSource: customer.pinnedSource ?? null,
    pinnedAt: customer.pinnedAt ?? null,
    salesStage: customer.salesStage,
  };
}

function extractChanges(result: unknown): number | null {
  if (
    result &&
    typeof result === "object" &&
    "meta" in result &&
    result.meta &&
    typeof result.meta === "object" &&
    "changes" in result.meta &&
    typeof (result.meta as { changes: unknown }).changes === "number"
  ) {
    return (result.meta as { changes: number }).changes;
  }
  return null;
}

function sqlPinnedSourceEquals(
  column: typeof schema.customers.pinnedSource,
  expected: string | null,
): SQL {
  if (expected === null) {
    return isNull(column);
  }
  return eq(column, expected as NonNullable<Customer["pinnedSource"]>);
}

function buildPriorityCustomerSnapshotGuard(
  customerId: string,
  snapshot: PriorityApprovalSnapshot,
): SQL {
  const expectedPinned = snapshot.expectedIsPinned ? 1 : 0;
  return sql`EXISTS (
    SELECT 1
    FROM ${schema.customers} c
    WHERE c.id = ${customerId}
      AND c.deleted_at IS NULL
      AND c.status NOT IN ('archived', 'public_pool')
      AND c.is_pinned = ${expectedPinned}
      AND c.sales_stage = ${snapshot.expectedSalesStage}
      AND (
        (${snapshot.expectedPinnedSource} IS NULL AND c.pinned_source IS NULL)
        OR c.pinned_source = ${snapshot.expectedPinnedSource}
      )
  )`;
}

function buildApprovalExecutionGuard(
  approvalId: string,
  reviewerId: string,
  now: string,
): SQL {
  return sql`EXISTS (
    SELECT 1
    FROM ${schema.approvals} a
    WHERE a.id = ${approvalId}
      AND a.status = 'approved'
      AND a.reviewed_by = ${reviewerId}
      AND a.reviewed_at = ${now}
      AND a.updated_at = ${now}
  )`;
}

export function buildPriorityApprovalCas(
  db: Database,
  params: {
    approvalId: string;
    customerId: string;
    reviewerId: string;
    adminComment: string | null;
    now: string;
    snapshot: PriorityApprovalSnapshot;
    requestType: PriorityRequestType;
  },
) {
  const snapshotGuard = buildPriorityCustomerSnapshotGuard(
    params.customerId,
    params.snapshot,
  );
  const unsetGuard =
    params.requestType === "unset_priority_customer"
      ? sql`EXISTS (
          SELECT 1
          FROM ${schema.customers} c
          WHERE c.id = ${params.customerId}
            AND c.sales_stage != 'on_hold'
        )`
      : sql`1 = 1`;

  return db
    .update(schema.approvals)
    .set({
      status: "approved",
      adminComment: params.adminComment,
      reviewedBy: params.reviewerId,
      reviewedAt: params.now,
      updatedAt: params.now,
    })
    .where(
      and(
        eq(schema.approvals.id, params.approvalId),
        eq(schema.approvals.status, "pending"),
        snapshotGuard,
        unsetGuard,
      ),
    );
}

function buildPrioritySetCustomerMutation(
  db: Database,
  params: {
    customerId: string;
    approvalId: string;
    reviewerId: string;
    now: string;
    snapshot: PriorityApprovalSnapshot;
  },
) {
  const patch = buildApprovalSetPriorityFields(params.now);
  return db
    .update(schema.customers)
    .set({
      ...patch,
      updatedBy: params.reviewerId,
      updatedAt: params.now,
    })
    .where(
      and(
        eq(schema.customers.id, params.customerId),
        isNull(schema.customers.deletedAt),
        ne(schema.customers.status, "archived"),
        ne(schema.customers.status, "public_pool"),
        eq(schema.customers.isPinned, 0),
        eq(schema.customers.salesStage, params.snapshot.expectedSalesStage),
        sqlPinnedSourceEquals(
          schema.customers.pinnedSource,
          params.snapshot.expectedPinnedSource,
        ),
        buildApprovalExecutionGuard(
          params.approvalId,
          params.reviewerId,
          params.now,
        ),
      ),
    );
}

function buildPriorityUnsetCustomerMutation(
  db: Database,
  params: {
    customerId: string;
    approvalId: string;
    reviewerId: string;
    now: string;
    snapshot: PriorityApprovalSnapshot;
  },
) {
  const patch = buildAdminRemovePriorityFields();
  return db
    .update(schema.customers)
    .set({
      ...patch,
      updatedBy: params.reviewerId,
      updatedAt: params.now,
    })
    .where(
      and(
        eq(schema.customers.id, params.customerId),
        isNull(schema.customers.deletedAt),
        ne(schema.customers.status, "archived"),
        ne(schema.customers.status, "public_pool"),
        eq(schema.customers.isPinned, 1),
        ne(schema.customers.salesStage, "on_hold"),
        eq(schema.customers.salesStage, params.snapshot.expectedSalesStage),
        sqlPinnedSourceEquals(
          schema.customers.pinnedSource,
          params.snapshot.expectedPinnedSource,
        ),
        buildApprovalExecutionGuard(
          params.approvalId,
          params.reviewerId,
          params.now,
        ),
      ),
    );
}

export function buildAdminDirectSetCustomerMutation(
  db: Database,
  params: {
    customerId: string;
    adminId: string;
    now: string;
    snapshot: PriorityAdminSnapshot;
  },
) {
  const patch = buildAdminSetPriorityFields(params.now);

  return db
    .update(schema.customers)
    .set({
      ...patch,
      updatedBy: params.adminId,
      updatedAt: params.now,
    })
    .where(
      and(
        eq(schema.customers.id, params.customerId),
        isNull(schema.customers.deletedAt),
        ne(schema.customers.status, "archived"),
        ne(schema.customers.status, "public_pool"),
        eq(schema.customers.isPinned, 0),
        eq(schema.customers.salesStage, params.snapshot.salesStage),
        sqlPinnedSourceEquals(
          schema.customers.pinnedSource,
          params.snapshot.pinnedSource,
        ),
        params.snapshot.pinnedAt === null
          ? isNull(schema.customers.pinnedAt)
          : eq(schema.customers.pinnedAt, params.snapshot.pinnedAt),
      ),
    );
}

export function buildAdminDirectRemoveCustomerMutation(
  db: Database,
  params: {
    customerId: string;
    adminId: string;
    now: string;
    snapshot: PriorityAdminSnapshot;
  },
) {
  const patch = buildAdminRemovePriorityFields();
  return db
    .update(schema.customers)
    .set({
      ...patch,
      updatedBy: params.adminId,
      updatedAt: params.now,
    })
    .where(
      and(
        eq(schema.customers.id, params.customerId),
        isNull(schema.customers.deletedAt),
        ne(schema.customers.status, "archived"),
        ne(schema.customers.status, "public_pool"),
        eq(schema.customers.isPinned, params.snapshot.isPinned),
        ne(schema.customers.salesStage, "on_hold"),
        eq(schema.customers.salesStage, params.snapshot.salesStage),
        sqlPinnedSourceEquals(
          schema.customers.pinnedSource,
          params.snapshot.pinnedSource,
        ),
        params.snapshot.pinnedAt === null
          ? isNull(schema.customers.pinnedAt)
          : eq(schema.customers.pinnedAt, params.snapshot.pinnedAt),
      ),
    );
}

export async function executeAtomicPriorityApproval(
  db: Database,
  approval: Approval,
  reviewer: User,
  adminComment?: string | null,
  options?: {
    testAppendStatements?: (ctx: { db: Database }) => unknown[];
  },
): Promise<"updated"> {
  const requestType = approval.requestType as PriorityRequestType;
  if (
    requestType !== "set_priority_customer" &&
    requestType !== "unset_priority_customer"
  ) {
    throw new ApprovalError(400, "无效的申请类型");
  }

  const snapshot = parsePriorityApprovalSnapshot(approval);
  if (!snapshot) {
    throw new ApprovalError(
      409,
      "客户优先状态已变更，无法继续处理此审批",
      PRIORITY_ERROR_CODES.STALE_PRIORITY_APPROVAL,
    );
  }

  const now = new Date().toISOString();
  const trimmedComment = adminComment?.trim() || null;

  const statements: unknown[] = [
    buildPriorityApprovalCas(db, {
      approvalId: approval.id,
      customerId: approval.customerId,
      reviewerId: reviewer.id,
      adminComment: trimmedComment,
      now,
      snapshot,
      requestType,
    }),
    requestType === "set_priority_customer"
      ? buildPrioritySetCustomerMutation(db, {
          customerId: approval.customerId,
          approvalId: approval.id,
          reviewerId: reviewer.id,
          now,
          snapshot,
        })
      : buildPriorityUnsetCustomerMutation(db, {
          customerId: approval.customerId,
          approvalId: approval.id,
          reviewerId: reviewer.id,
          now,
          snapshot,
        }),
  ];

  if (options?.testAppendStatements) {
    statements.push(...options.testAppendStatements({ db }));
  }

  const batchResults = (await db.batch(
    statements as unknown as Parameters<Database["batch"]>[0],
  )) as readonly unknown[];

  const casChanges = extractChanges(batchResults[0]);
  const customerChanges = extractChanges(batchResults[1]);

  if (casChanges !== 1 || customerChanges !== 1) {
    throw new ApprovalError(
      409,
      "客户优先状态已变更，无法继续处理此审批",
      PRIORITY_ERROR_CODES.STALE_PRIORITY_APPROVAL,
    );
  }

  return "updated";
}
