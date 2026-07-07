import { and, desc, eq, inArray } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { schema } from "@/lib/db";
import {
  getCustomerAccessLevel,
  PermissionError,
  type CustomerAccessOptions,
} from "@/lib/permissions/customers";
import type { Customer } from "../../../../drizzle/schema/customers";
import type { User } from "../../../../drizzle/schema/users";
import {
  CUSTOMER_TIMELINE_AUDIT_ACTIONS,
  SENSITIVE_FIELD_NAMES,
  TASK_TIMELINE_AUDIT_ACTIONS,
} from "./constants";
import type { TimelineItem, TimelineResponse } from "./types";
import { formatHongKongDateTime } from "@/lib/timezone";

type Visibility = "full" | "masked";

const AUDIT_ACTION_MESSAGE_KEYS: Record<string, string> = {
  "customer.created": "customerCreated",
  "customer.updated": "customerUpdated",
  "customer.imported": "customerImported",
  "customer.released_to_pool": "customerReleasedToPool",
  "customer.claimed_from_pool": "customerClaimedFromPool",
  "customer.auto_reclaimed_to_pool": "customerAutoReclaimed",
  "customer.transferred": "customerTransferred",
  "customer.transferred.staff_deleted": "customerTransferredStaffDeleted",
  "customer.closed_won.approved": "customerClosedWonApproved",
  "customer.paid.approved": "customerPaidApproved",
  "customer.on_hold_create.approved": "customerOnHoldCreateApproved",
  "customer.on_hold_create.rejected": "customerOnHoldCreateRejected",
  "customer.deleted.soft": "customerSoftDeleted",
  "customer.auto_reclaim_warning.day_6": "autoReclaimWarningDay6",
  "customer.auto_reclaim_warning.day_7": "autoReclaimWarningDay7",
  "task.created": "taskCreatedAudit",
  "task.created.first_contact": "taskFirstContactCreated",
  "task.updated": "taskUpdatedAudit",
  "task.completed": "taskCompletedAudit",
  "task.cancelled.auto_reclaim": "taskCancelledAutoReclaim",
};

const TASK_EVENT_TITLE_KEYS = {
  created: "taskCreated",
  completed: "taskCompleted",
  cancelled: "taskCancelled",
} as const;

const EMPTY_MARKER = "__empty__";

function isMaskedTimeline(accessLevel: ReturnType<typeof getCustomerAccessLevel>): boolean {
  return accessLevel === "masked" || accessLevel === "archived_basic";
}

export function assertCanViewCustomerTimeline(
  user: User,
  customer: Customer,
  options?: CustomerAccessOptions,
): ReturnType<typeof getCustomerAccessLevel> {
  const level = getCustomerAccessLevel(user, customer, options);
  if (level === "denied") {
    throw new PermissionError(
      403,
      "无权查看该客户时间线",
      "permission.denied.customer_timeline_access",
    );
  }
  return level;
}

async function loadActorNames(
  db: Database,
  userIds: Array<string | null | undefined>,
): Promise<Map<string, string>> {
  const ids = [...new Set(userIds.filter((id): id is string => !!id))];
  if (ids.length === 0) {
    return new Map();
  }
  const rows = await db
    .select({
      id: schema.users.id,
      displayName: schema.users.displayName,
    })
    .from(schema.users)
    .where(inArray(schema.users.id, ids));
  return new Map(rows.map((row) => [row.id, row.displayName]));
}

function actorFromMap(
  map: Map<string, string>,
  userId: string | null | undefined,
): { name: string; isSystem: boolean } {
  if (!userId) return { name: "", isSystem: true };
  return { name: map.get(userId) ?? "", isSystem: false };
}

function parseAuditMetadata(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function displayValue(value: string | null | undefined): string {
  return value?.trim() ? value : EMPTY_MARKER;
}

function buildAuditItem(
  row: typeof schema.auditLogs.$inferSelect,
  actorMap: Map<string, string>,
  visibility: Visibility,
): TimelineItem | null {
  const isCustomerAudit = CUSTOMER_TIMELINE_AUDIT_ACTIONS.has(row.action);
  const isTaskAudit = TASK_TIMELINE_AUDIT_ACTIONS.has(row.action);
  if (!isCustomerAudit && !isTaskAudit) {
    return null;
  }

  const metadata = parseAuditMetadata(row.metadata);
  const titleKey = `timelineMessages.${
    AUDIT_ACTION_MESSAGE_KEYS[row.action] ?? "customerUpdated"
  }`;
  const isSystem =
    !row.userId ||
    row.action.startsWith("customer.auto_reclaim") ||
    row.action === "task.cancelled.auto_reclaim";

  let descriptionKey: string | undefined;
  let descriptionParams: Record<string, string> | undefined;

  if (row.action === "customer.released_to_pool" && metadata.poolReason) {
    descriptionKey = "timelineMessages.releasedToPoolReason";
    descriptionParams = { reason: String(metadata.poolReason) };
  } else if (row.action === "customer.imported" && metadata.importJobId) {
    descriptionKey = "timelineMessages.importedJob";
    descriptionParams = { jobId: String(metadata.importJobId) };
  } else if (row.action === "customer.transferred.staff_deleted") {
    descriptionKey = "timelineMessages.staffDeletedTransfer";
    descriptionParams = {
      previousOwnerName: String(metadata.previousOwnerName ?? ""),
      newOwnerName: String(metadata.newOwnerName ?? ""),
    };
  } else if (row.action === "customer.on_hold_create.approved") {
    descriptionKey = "timelineMessages.onHoldCreateApproved";
    descriptionParams = {
      requestedByName: String(metadata.requestedByName ?? ""),
      onHoldReason: String(metadata.onHoldReason ?? ""),
    };
  } else if (row.action === "customer.on_hold_create.rejected") {
    descriptionKey = "timelineMessages.onHoldCreateRejected";
    descriptionParams = {
      adminComment: String(metadata.adminComment ?? ""),
    };
  } else if (isTaskAudit) {
    const parts: string[] = [];
    if (metadata.taskType) parts.push(String(metadata.taskType));
    if (metadata.dueAt) {
      descriptionKey = "timelineMessages.taskDue";
      descriptionParams = {
        dueAt: formatHongKongDateTime(String(metadata.dueAt)),
      };
    }
    if (parts.length > 0 && !descriptionKey) {
      descriptionKey = "timelineMessages.taskDescription";
      descriptionParams = {
        title: String(metadata.title ?? ""),
        type: String(metadata.taskType ?? ""),
        status: String(metadata.status ?? ""),
      };
    }
  }

  const sensitive =
    visibility === "masked" &&
    (row.action === "customer.updated" || row.action === "customer.imported");

  const actor = isSystem
    ? { name: "", isSystem: true }
    : actorFromMap(actorMap, row.userId);

  return {
    id: `audit-${row.id}`,
    type: "audit",
    titleKey,
    descriptionKey: sensitive
      ? "timelineMessages.detailsHidden"
      : descriptionKey,
    descriptionParams: sensitive ? undefined : descriptionParams,
    actorName: actor.name,
    actorIsSystem: actor.isSystem,
    occurredAt: row.createdAt,
    metadata: {
      category: isSystem ? "system" : "customer",
      action: row.action,
      ...(visibility === "full" ? metadata : {}),
    },
    sensitive,
  };
}

function buildFieldChangeItem(
  row: typeof schema.fieldChangeLogs.$inferSelect,
  actorMap: Map<string, string>,
  visibility: Visibility,
): TimelineItem {
  const isSensitive = SENSITIVE_FIELD_NAMES.has(row.fieldName);
  const actor = actorFromMap(actorMap, row.changedBy);

  if (visibility === "masked" && isSensitive) {
    return {
      id: `field-${row.id}`,
      type: "field_change",
      titleKey: "timelineMessages.fieldChanged",
      titleParams: { field: row.fieldName },
      descriptionKey: "timelineMessages.sensitiveFieldChanged",
      actorName: actor.name,
      actorIsSystem: actor.isSystem,
      occurredAt: row.changedAt,
      metadata: {
        category: "field_change",
        field_name: row.fieldName,
      },
      sensitive: true,
    };
  }

  return {
    id: `field-${row.id}`,
    type: "field_change",
    titleKey: "timelineMessages.fieldChanged",
    titleParams: { field: row.fieldName },
    descriptionKey: "timelineMessages.fieldChangedFromTo",
    descriptionParams: {
      oldValue: displayValue(row.oldValue),
      newValue: displayValue(row.newValue),
    },
    actorName: actor.name,
    actorIsSystem: actor.isSystem,
    occurredAt: row.changedAt,
    metadata: {
      category: "field_change",
      field_name: row.fieldName,
      old_value: row.oldValue,
      new_value: row.newValue,
      changed_by: row.changedBy,
      changed_at: row.changedAt,
    },
    sensitive: false,
  };
}

function buildFollowUpItem(
  row: typeof schema.followUps.$inferSelect,
  actorMap: Map<string, string>,
  visibility: Visibility,
): TimelineItem {
  const masked = visibility === "masked";
  const actor = actorFromMap(actorMap, row.userId);
  const validity = row.isValidFollowUp === 1 ? "valid" : "invalid";

  return {
    id: `follow-up-${row.id}`,
    type: "follow_up",
    titleKey: "timelineMessages.followUpRecord",
    titleParams: { channel: row.channel },
    descriptionKey: masked
      ? "timelineMessages.followUpMaskedDescription"
      : "timelineMessages.followUpDescription",
    descriptionParams: {
      outcome: row.outcome,
      validity,
      ...(masked ? {} : { summary: row.summary ? `: ${row.summary}` : "" }),
    },
    actorName: actor.name,
    actorIsSystem: actor.isSystem,
    occurredAt: row.followUpTime,
    metadata: {
      category: "follow_up",
      follow_up_time: row.followUpTime,
      channel: row.channel,
      outcome: row.outcome,
      is_valid_follow_up: row.isValidFollowUp === 1,
      next_follow_up_at: row.nextFollowUpAt,
      ...(masked ? {} : { summary: row.summary }),
    },
    sensitive: masked,
  };
}

function buildTaskItemFromRow(
  row: typeof schema.tasks.$inferSelect,
  actorMap: Map<string, string>,
  event: "created" | "completed" | "cancelled",
  occurredAt: string,
): TimelineItem {
  const actor = actorFromMap(actorMap, row.createdBy);

  return {
    id: `task-${row.id}-${event}`,
    type: "task",
    titleKey: `timelineMessages.${TASK_EVENT_TITLE_KEYS[event]}`,
    descriptionKey: "timelineMessages.taskDescription",
    descriptionParams: {
      title: row.title,
      type: row.type,
      status: row.status,
    },
    actorName: actor.name,
    actorIsSystem: actor.isSystem,
    occurredAt,
    metadata: {
      category: "task",
      title: row.title,
      type: row.type,
      status: row.status,
      due_at: row.dueAt,
      completed_at: row.completedAt,
      event,
    },
    sensitive: false,
  };
}

function buildApprovalItem(
  row: typeof schema.approvals.$inferSelect,
  actorMap: Map<string, string>,
  visibility: Visibility,
): TimelineItem {
  const masked = visibility === "masked";
  const actor = actorFromMap(actorMap, row.requestedBy);

  let descriptionKey = "timelineMessages.approvalStatus";
  let descriptionParams: Record<string, string> = {
    status: row.status,
    type: row.requestType,
  };

  if (!masked && row.reason && row.adminComment) {
    descriptionKey = "timelineMessages.approvalWithAdminComment";
    descriptionParams = {
      status: row.status,
      comment: row.adminComment,
    };
  } else if (!masked && row.reason) {
    descriptionKey = "timelineMessages.approvalWithReason";
    descriptionParams = {
      status: row.status,
      reason: row.reason,
    };
  } else if (masked) {
    descriptionKey = "timelineMessages.approvalStatus";
    descriptionParams = { status: row.status };
  }

  return {
    id: `approval-${row.id}`,
    type: "approval",
    titleKey: "timelineMessages.approvalTitle",
    titleParams: { type: row.requestType },
    descriptionKey,
    descriptionParams,
    actorName: actor.name,
    actorIsSystem: actor.isSystem,
    occurredAt: row.reviewedAt ?? row.createdAt,
    metadata: {
      category: "approval",
      request_type: row.requestType,
      status: row.status,
      requested_by: row.requestedBy,
      reviewed_by: row.reviewedBy,
      created_at: row.createdAt,
      reviewed_at: row.reviewedAt,
      ...(masked
        ? {}
        : {
            reason: row.reason,
            admin_comment: row.adminComment,
          }),
    },
    sensitive: masked,
  };
}

export async function getCustomerTimeline(
  db: Database,
  user: User,
  customer: Customer,
  options?: CustomerAccessOptions,
): Promise<TimelineResponse> {
  const accessLevel = assertCanViewCustomerTimeline(user, customer, options);
  const visibility: Visibility = isMaskedTimeline(accessLevel) ? "masked" : "full";

  const customerId = customer.id;

  const [customerAudits, fieldChanges, followUps, tasks, approvals] =
    await Promise.all([
      db
        .select()
        .from(schema.auditLogs)
        .where(
          and(
            eq(schema.auditLogs.entityType, "customer"),
            eq(schema.auditLogs.entityId, customerId),
          ),
        )
        .orderBy(desc(schema.auditLogs.createdAt)),
      db
        .select()
        .from(schema.fieldChangeLogs)
        .where(eq(schema.fieldChangeLogs.customerId, customerId))
        .orderBy(desc(schema.fieldChangeLogs.changedAt)),
      db
        .select()
        .from(schema.followUps)
        .where(eq(schema.followUps.customerId, customerId))
        .orderBy(desc(schema.followUps.followUpTime)),
      db
        .select()
        .from(schema.tasks)
        .where(eq(schema.tasks.customerId, customerId))
        .orderBy(desc(schema.tasks.createdAt)),
      db
        .select()
        .from(schema.approvals)
        .where(eq(schema.approvals.customerId, customerId))
        .orderBy(desc(schema.approvals.createdAt)),
    ]);

  const taskIds = tasks.map((t) => t.id);
  const taskAudits =
    taskIds.length > 0
      ? await db
          .select()
          .from(schema.auditLogs)
          .where(
            and(
              eq(schema.auditLogs.entityType, "task"),
              inArray(schema.auditLogs.entityId, taskIds),
            ),
          )
          .orderBy(desc(schema.auditLogs.createdAt))
      : [];

  const actorIds: Array<string | null | undefined> = [
    ...customerAudits.map((r) => r.userId),
    ...taskAudits.map((r) => r.userId),
    ...fieldChanges.map((r) => r.changedBy),
    ...followUps.map((r) => r.userId),
    ...tasks.map((r) => r.createdBy),
    ...approvals.map((r) => r.requestedBy),
    ...approvals.map((r) => r.reviewedBy),
    customer.createdBy,
  ];

  const actorMap = await loadActorNames(db, actorIds);

  const items: TimelineItem[] = [];

  for (const row of customerAudits) {
    const item = buildAuditItem(row, actorMap, visibility);
    if (item) items.push(item);
  }

  for (const row of taskAudits) {
    const item = buildAuditItem(row, actorMap, visibility);
    if (item) {
      items.push({
        ...item,
        type: "task",
        metadata: { ...item.metadata, category: "task" },
      });
    }
  }

  const taskAuditKeys = new Set(
    taskAudits.map((a) => `${a.entityId}:${a.action}`),
  );

  for (const row of tasks) {
    if (!taskAuditKeys.has(`${row.id}:task.created`) && !taskAuditKeys.has(`${row.id}:task.created.first_contact`)) {
      items.push(
        buildTaskItemFromRow(row, actorMap, "created", row.createdAt),
      );
    }
    if (
      row.status === "completed" &&
      row.completedAt &&
      !taskAuditKeys.has(`${row.id}:task.completed`)
    ) {
      items.push(
        buildTaskItemFromRow(row, actorMap, "completed", row.completedAt),
      );
    }
    if (
      row.status === "cancelled" &&
      !taskAuditKeys.has(`${row.id}:task.cancelled.auto_reclaim`)
    ) {
      items.push(
        buildTaskItemFromRow(row, actorMap, "cancelled", row.updatedAt),
      );
    }
  }

  for (const row of fieldChanges) {
    items.push(buildFieldChangeItem(row, actorMap, visibility));
  }

  for (const row of followUps) {
    items.push(buildFollowUpItem(row, actorMap, visibility));
  }

  for (const row of approvals) {
    items.push(buildApprovalItem(row, actorMap, visibility));
  }

  if (!customerAudits.some((a) => a.action === "customer.created")) {
    const actor = actorFromMap(actorMap, customer.createdBy);
    items.push({
      id: `customer-created-${customer.id}`,
      type: "audit",
      titleKey: "timelineMessages.customerCreated",
      descriptionKey: "timelineMessages.customerCreatedDescription",
      descriptionParams: { name: customer.customerName },
      actorName: actor.name,
      actorIsSystem: actor.isSystem,
      occurredAt: customer.createdAt,
      metadata: { category: "customer", action: "customer.created" },
      sensitive: false,
    });
  }

  items.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));

  return {
    items,
    accessLevel:
      accessLevel === "archived_basic" ? "archived_basic" : visibility === "masked" ? "masked" : "full",
  };
}
