import { and, desc, eq, inArray } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { schema } from "@/lib/db";
import {
  getCustomerAccessLevel,
  PermissionError,
} from "@/lib/permissions/customers";
import {
  APPROVAL_REQUEST_TYPE_LABELS,
  APPROVAL_STATUS_LABELS,
} from "@/lib/approvals/constants";
import {
  FOLLOW_UP_CHANNEL_LABELS,
  type FollowUpChannel,
} from "@/lib/constants/follow-up-channels";
import {
  FOLLOW_UP_OUTCOME_LABELS,
  type FollowUpOutcome,
} from "@/lib/constants/follow-up-outcomes";
import type { Customer } from "../../../../drizzle/schema/customers";
import type { User } from "../../../../drizzle/schema/users";
import {
  AUDIT_ACTION_LABELS,
  CUSTOMER_TIMELINE_AUDIT_ACTIONS,
  FIELD_NAME_LABELS,
  SENSITIVE_FIELD_NAMES,
  TASK_STATUS_LABELS,
  TASK_TIMELINE_AUDIT_ACTIONS,
  TASK_TYPE_LABELS,
} from "./constants";
import type { TimelineItem, TimelineResponse } from "./types";

type Visibility = "full" | "masked";

function isMaskedTimeline(accessLevel: ReturnType<typeof getCustomerAccessLevel>): boolean {
  return accessLevel === "masked" || accessLevel === "archived_basic";
}

export function assertCanViewCustomerTimeline(
  user: User,
  customer: Customer,
): ReturnType<typeof getCustomerAccessLevel> {
  const level = getCustomerAccessLevel(user, customer);
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
): string {
  if (!userId) return "系统";
  return map.get(userId) ?? "未知用户";
}

function parseAuditMetadata(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
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
  const title = AUDIT_ACTION_LABELS[row.action] ?? row.action;
  const isSystem =
    !row.userId ||
    row.action.startsWith("customer.auto_reclaim") ||
    row.action === "task.cancelled.auto_reclaim";

  let description = title;
  if (row.action === "customer.released_to_pool" && metadata.poolReason) {
    description = `释放原因：${String(metadata.poolReason)}`;
  } else if (row.action === "customer.imported" && metadata.importJobId) {
    description = `导入任务：${String(metadata.importJobId)}`;
  } else if (isTaskAudit) {
    const parts: string[] = [];
    if (metadata.taskType) parts.push(TASK_TYPE_LABELS[String(metadata.taskType)] ?? String(metadata.taskType));
    if (metadata.dueAt) parts.push(`截止：${String(metadata.dueAt).slice(0, 16).replace("T", " ")}`);
    if (parts.length > 0) description = parts.join(" · ");
  }

  const sensitive =
    visibility === "masked" &&
    (row.action === "customer.updated" ||
      row.action === "customer.imported");

  return {
    id: `audit-${row.id}`,
    type: "audit",
    title,
    description: sensitive ? "操作详情已隐藏（脱敏）" : description,
    actorName: isSystem ? "系统" : actorFromMap(actorMap, row.userId),
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
  const fieldLabel = FIELD_NAME_LABELS[row.fieldName] ?? row.fieldName;
  const isSensitive = SENSITIVE_FIELD_NAMES.has(row.fieldName);

  if (visibility === "masked" && isSensitive) {
    return {
      id: `field-${row.id}`,
      type: "field_change",
      title: "字段变更",
      description: "敏感字段已变更",
      actorName: actorFromMap(actorMap, row.changedBy),
      occurredAt: row.changedAt,
      metadata: {
        category: "field_change",
        field_name: row.fieldName,
        field_label: fieldLabel,
      },
      sensitive: true,
    };
  }

  const oldVal = row.oldValue ?? "（空）";
  const newVal = row.newValue ?? "（空）";

  return {
    id: `field-${row.id}`,
    type: "field_change",
    title: `${fieldLabel}已变更`,
    description: `${oldVal} → ${newVal}`,
    actorName: actorFromMap(actorMap, row.changedBy),
    occurredAt: row.changedAt,
    metadata: {
      category: "field_change",
      field_name: row.fieldName,
      field_label: fieldLabel,
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
  const channel =
    FOLLOW_UP_CHANNEL_LABELS[row.channel as FollowUpChannel] ?? row.channel;
  const outcome =
    FOLLOW_UP_OUTCOME_LABELS[row.outcome as FollowUpOutcome] ?? row.outcome;
  const validLabel = row.isValidFollowUp === 1 ? "有效跟进" : "无效跟进";

  const masked = visibility === "masked";

  return {
    id: `follow-up-${row.id}`,
    type: "follow_up",
    title: `跟进记录 · ${channel}`,
    description: masked
      ? `${outcome} · ${validLabel}（跟进内容已隐藏）`
      : `${outcome} · ${validLabel}${row.summary ? `：${row.summary}` : ""}`,
    actorName: actorFromMap(actorMap, row.userId),
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
  const typeLabel = TASK_TYPE_LABELS[row.type] ?? row.type;
  const statusLabel = TASK_STATUS_LABELS[row.status] ?? row.status;

  const titles = {
    created: "任务已创建",
    completed: "任务已完成",
    cancelled: "任务已取消",
  };

  return {
    id: `task-${row.id}-${event}`,
    type: "task",
    title: titles[event],
    description: `${row.title}（${typeLabel} · ${statusLabel}）`,
    actorName: actorFromMap(actorMap, row.createdBy),
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
  const typeLabel =
    APPROVAL_REQUEST_TYPE_LABELS[row.requestType] ?? row.requestType;
  const statusLabel = APPROVAL_STATUS_LABELS[row.status] ?? row.status;

  const masked = visibility === "masked";

  return {
    id: `approval-${row.id}`,
    type: "approval",
    title: `审批 · ${typeLabel}`,
    description: masked
      ? `状态：${statusLabel}（审批详情已隐藏）`
      : `状态：${statusLabel}${row.reason ? ` · 原因：${row.reason}` : ""}${row.adminComment ? ` · 管理员备注：${row.adminComment}` : ""}`,
    actorName: actorFromMap(actorMap, row.requestedBy),
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
): Promise<TimelineResponse> {
  const accessLevel = assertCanViewCustomerTimeline(user, customer);
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
    items.push({
      id: `customer-created-${customer.id}`,
      type: "audit",
      title: "客户已创建",
      description: `客户「${customer.customerName}」已创建`,
      actorName: actorFromMap(actorMap, customer.createdBy),
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
