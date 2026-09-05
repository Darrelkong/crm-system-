import { and, eq, inArray } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { schema } from "@/lib/db";
import {
  listCustomerAssignees,
  type CustomerAssigneeRecord,
} from "@/lib/customers/assignees";
import {
  assertCustomerCollaboratorsMutable,
  assertValidCollaboratorAssignees,
  AssigneeMutationError,
} from "@/lib/customers/assignees-mutations";
import { validateCollaboratorUserIds } from "@/lib/customers/assignees-validation";
import { assertCanManageCustomerCollaborators } from "@/lib/permissions/customers";
import { createNotificationOnce } from "@/lib/notifications/service";
import type { Customer } from "../../../drizzle/schema/customers";
import type { User } from "../../../drizzle/schema/users";

export const COLLABORATOR_ADDED_AUDIT_ACTION = "customer.collaborator_added";
export const COLLABORATOR_REMOVED_AUDIT_ACTION =
  "customer.collaborator_removed";

export type CustomerCollaboratorMutationResult = {
  collaborators: CustomerAssigneeRecord[];
  assignees: CustomerAssigneeRecord[];
};

type CollaboratorMutationActor = Pick<User, "id" | "role">;

type CollaboratorEvent = {
  auditId: string;
  action: "added" | "removed";
  collaboratorUserId: string;
  collaboratorName: string;
};

function mutationError(
  code: ConstructorParameters<typeof AssigneeMutationError>[0],
  message: string,
): AssigneeMutationError {
  return new AssigneeMutationError(code, message);
}

async function assertDirectMutationAllowed(
  db: Database,
  actor: CollaboratorMutationActor,
  customer: Customer,
): Promise<void> {
  assertCanManageCustomerCollaborators(actor as User, customer);
  await assertCustomerCollaboratorsMutable(db, customer.id);
}

async function getUserSummary(
  db: Database,
  userId: string,
): Promise<{ id: string; displayName: string } | null> {
  const rows = await db
    .select({
      id: schema.users.id,
      displayName: schema.users.displayName,
    })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  return rows[0] ?? null;
}

async function getUserSummaries(
  db: Database,
  userIds: string[],
): Promise<Map<string, string>> {
  if (userIds.length === 0) {
    return new Map();
  }
  const rows = await db
    .select({
      id: schema.users.id,
      displayName: schema.users.displayName,
    })
    .from(schema.users)
    .where(inArray(schema.users.id, userIds));
  return new Map(rows.map((row) => [row.id, row.displayName]));
}

function buildAuditStatement(
  db: Database,
  input: {
    id: string;
    actorId: string;
    customer: Customer;
    collaboratorUserId: string;
    collaboratorName: string;
    action: string;
    now: string;
  },
) {
  return db.insert(schema.auditLogs).values({
    id: input.id,
    userId: input.actorId,
    action: input.action,
    entityType: "customer",
    entityId: input.customer.id,
    metadata: JSON.stringify({
      customerId: input.customer.id,
      collaboratorUserId: input.collaboratorUserId,
      collaboratorName: input.collaboratorName,
      action:
        input.action === COLLABORATOR_ADDED_AUDIT_ACTION ? "add" : "remove",
    }),
    createdAt: input.now,
  });
}

async function writeCoreMutation(
  db: Database,
  statements: unknown[],
): Promise<void> {
  await db.batch(statements as unknown as Parameters<Database["batch"]>[0]);
}

async function notifyCollaboratorEvent(
  db: Database,
  customer: Customer,
  actorId: string,
  event: CollaboratorEvent,
): Promise<void> {
  try {
    const actor = await getUserSummary(db, actorId);
    const type =
      event.action === "added"
        ? "customer.collaborator_added"
        : "customer.collaborator_removed";
    const messageKey =
      event.action === "added"
        ? "notificationMessages.collaboratorAdded"
        : "notificationMessages.collaboratorRemoved";

    await createNotificationOnce(db, {
      userId: event.collaboratorUserId,
      type,
      titleKey: `notificationTypes.${type.replace(/\./g, "_")}`,
      messageKey,
      messageParams: {
        actorName: actor?.displayName ?? actorId,
        customerName: customer.customerName,
      },
      relatedEntityType: "customer",
      relatedEntityId: customer.id,
    });
  } catch (error) {
    // Membership and audit are already durable. Notification delivery is best effort.
    console.error("customer collaborator notification failed", {
      customerId: customer.id,
      collaboratorUserId: event.collaboratorUserId,
      action: event.action,
      error,
    });
  }
}

async function notifyCollaboratorEvents(
  db: Database,
  customer: Customer,
  actorId: string,
  events: CollaboratorEvent[],
): Promise<void> {
  await Promise.all(
    events.map((event) =>
      notifyCollaboratorEvent(db, customer, actorId, event),
    ),
  );
}

export async function notifyCustomerCollaboratorAdded(
  db: Database,
  customer: Customer,
  actorId: string,
  event: {
    auditId: string;
    collaboratorUserId: string;
    collaboratorName: string;
  },
): Promise<void> {
  await notifyCollaboratorEvent(db, customer, actorId, {
    ...event,
    action: "added",
  });
}

export async function listCustomerCollaborators(
  db: Database,
  customerId: string,
): Promise<CustomerAssigneeRecord[]> {
  const assignees = await listCustomerAssignees(db, customerId);
  return assignees.filter((row) => row.role === "collaborator");
}

export async function addCustomerCollaborator(
  db: Database,
  input: {
    actor: CollaboratorMutationActor;
    customer: Customer;
    collaboratorUserId: string;
    now?: string;
  },
): Promise<CustomerCollaboratorMutationResult> {
  await assertDirectMutationAllowed(db, input.actor, input.customer);

  if (input.actor.id === input.collaboratorUserId) {
    throw mutationError("COLLABORATOR_SELF", "不能将自己加入为协作成员");
  }

  await assertValidCollaboratorAssignees(db, input.customer.id, [
    input.collaboratorUserId,
  ]);

  const existing = await db
    .select({ id: schema.customerAssignees.id })
    .from(schema.customerAssignees)
    .where(
      and(
        eq(schema.customerAssignees.customerId, input.customer.id),
        eq(schema.customerAssignees.userId, input.collaboratorUserId),
      ),
    )
    .limit(1);
  if (existing.length > 0) {
    throw mutationError("COLLABORATOR_ALREADY_EXISTS", "该员工已经是协作成员");
  }

  const target = await getUserSummary(db, input.collaboratorUserId);
  const collaboratorName = target?.displayName ?? input.collaboratorUserId;
  const now = input.now ?? new Date().toISOString();
  const auditId = crypto.randomUUID();

  const insertStatement = db.insert(schema.customerAssignees).values({
    id: crypto.randomUUID(),
    customerId: input.customer.id,
    userId: input.collaboratorUserId,
    role: "collaborator",
    assignedBy: input.actor.id,
    assignedAt: now,
    createdAt: now,
    updatedAt: now,
  });

  await writeCoreMutation(db, [
    insertStatement,
    buildAuditStatement(db, {
      id: auditId,
      actorId: input.actor.id,
      customer: input.customer,
      collaboratorUserId: input.collaboratorUserId,
      collaboratorName,
      action: COLLABORATOR_ADDED_AUDIT_ACTION,
      now,
    }),
  ]);

  await notifyCollaboratorEvent(db, input.customer, input.actor.id, {
    auditId,
    action: "added",
    collaboratorUserId: input.collaboratorUserId,
    collaboratorName,
  });

  const assignees = await listCustomerAssignees(db, input.customer.id);
  return {
    collaborators: assignees.filter((row) => row.role === "collaborator"),
    assignees,
  };
}
export async function removeCustomerCollaborator(
  db: Database,
  input: {
    actor: CollaboratorMutationActor;
    customer: Customer;
    collaboratorUserId: string;
    now?: string;
  },
): Promise<CustomerCollaboratorMutationResult> {
  await assertDirectMutationAllowed(db, input.actor, input.customer);

  const existing = await db
    .select({ id: schema.customerAssignees.id })
    .from(schema.customerAssignees)
    .where(
      and(
        eq(schema.customerAssignees.customerId, input.customer.id),
        eq(schema.customerAssignees.userId, input.collaboratorUserId),
        eq(schema.customerAssignees.role, "collaborator"),
      ),
    )
    .limit(1);
  if (existing.length === 0) {
    throw mutationError("COLLABORATOR_NOT_FOUND", "该员工不是此客户的协作成员");
  }

  const target = await getUserSummary(db, input.collaboratorUserId);
  const collaboratorName = target?.displayName ?? input.collaboratorUserId;
  const now = input.now ?? new Date().toISOString();
  const auditId = crypto.randomUUID();
  const deleteStatement = db
    .delete(schema.customerAssignees)
    .where(
      and(
        eq(schema.customerAssignees.customerId, input.customer.id),
        eq(schema.customerAssignees.userId, input.collaboratorUserId),
        eq(schema.customerAssignees.role, "collaborator"),
      ),
    );

  await writeCoreMutation(db, [
    deleteStatement,
    buildAuditStatement(db, {
      id: auditId,
      actorId: input.actor.id,
      customer: input.customer,
      collaboratorUserId: input.collaboratorUserId,
      collaboratorName,
      action: COLLABORATOR_REMOVED_AUDIT_ACTION,
      now,
    }),
  ]);

  await notifyCollaboratorEvent(db, input.customer, input.actor.id, {
    auditId,
    action: "removed",
    collaboratorUserId: input.collaboratorUserId,
    collaboratorName,
  });

  const assignees = await listCustomerAssignees(db, input.customer.id);
  return {
    collaborators: assignees.filter((row) => row.role === "collaborator"),
    assignees,
  };
}
/**
 * Incremental-set compatibility for the existing Admin picker. It only
 * inserts/removes changed collaborator rows and never touches the primary row.
 */
export async function setCustomerCollaborators(
  db: Database,
  input: {
    actor: CollaboratorMutationActor;
    customer: Customer;
    collaboratorUserIds: unknown;
    now?: string;
  },
): Promise<CustomerCollaboratorMutationResult> {
  await assertDirectMutationAllowed(db, input.actor, input.customer);

  const validation = validateCollaboratorUserIds(input.collaboratorUserIds);
  if (!validation.ok) {
    throw mutationError(
      "INVALID_COLLABORATOR_IDS",
      validation.errors[0]?.message ?? "无效的协作成员列表",
    );
  }

  await assertValidCollaboratorAssignees(
    db,
    input.customer.id,
    validation.value,
  );

  const current = await listCustomerCollaborators(db, input.customer.id);
  const currentIds = new Set(current.map((row) => row.userId));
  const requestedIds = new Set(validation.value);
  const addedIds = validation.value.filter((id) => !currentIds.has(id));
  const removedIds = current
    .map((row) => row.userId)
    .filter((id) => !requestedIds.has(id));

  if (addedIds.length === 0 && removedIds.length === 0) {
    const assignees = await listCustomerAssignees(db, input.customer.id);
    return { collaborators: current, assignees };
  }

  const now = input.now ?? new Date().toISOString();
  const nameMap = await getUserSummaries(db, [
    ...new Set([...addedIds, ...removedIds]),
  ]);
  const events: CollaboratorEvent[] = [];
  const statements: unknown[] = [];

  if (removedIds.length > 0) {
    statements.push(
      db
        .delete(schema.customerAssignees)
        .where(
          and(
            eq(schema.customerAssignees.customerId, input.customer.id),
            eq(schema.customerAssignees.role, "collaborator"),
            inArray(schema.customerAssignees.userId, removedIds),
          ),
        ),
    );
  }

  for (const collaboratorUserId of addedIds) {
    const collaboratorName =
      nameMap.get(collaboratorUserId) ?? collaboratorUserId;
    statements.push(
      db.insert(schema.customerAssignees).values({
        id: crypto.randomUUID(),
        customerId: input.customer.id,
        userId: collaboratorUserId,
        role: "collaborator",
        assignedBy: input.actor.id,
        assignedAt: now,
        createdAt: now,
        updatedAt: now,
      }),
    );
    const auditId = crypto.randomUUID();
    statements.push(
      buildAuditStatement(db, {
        id: auditId,
        actorId: input.actor.id,
        customer: input.customer,
        collaboratorUserId,
        collaboratorName,
        action: COLLABORATOR_ADDED_AUDIT_ACTION,
        now,
      }),
    );
    events.push({
      auditId,
      action: "added",
      collaboratorUserId,
      collaboratorName,
    });
  }

  for (const collaboratorUserId of removedIds) {
    const collaboratorName =
      nameMap.get(collaboratorUserId) ?? collaboratorUserId;
    const auditId = crypto.randomUUID();
    statements.push(
      buildAuditStatement(db, {
        id: auditId,
        actorId: input.actor.id,
        customer: input.customer,
        collaboratorUserId,
        collaboratorName,
        action: COLLABORATOR_REMOVED_AUDIT_ACTION,
        now,
      }),
    );
    events.push({
      auditId,
      action: "removed",
      collaboratorUserId,
      collaboratorName,
    });
  }

  await writeCoreMutation(db, statements);
  await notifyCollaboratorEvents(db, input.customer, input.actor.id, events);

  const assignees = await listCustomerAssignees(db, input.customer.id);
  return {
    collaborators: assignees.filter((row) => row.role === "collaborator"),
    assignees,
  };
}
