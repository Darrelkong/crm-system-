import { and, eq, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { schema, type Database } from "@/lib/db";
import type { Customer } from "../../../drizzle/schema/customers";
import { buildReclamationCycleResetFields, getReclamationCycleStartedAt } from "@/lib/reclamation/cycle";
/** The strict primary-key insert is first: a replay rolls back the entire losing batch. */
export async function commitFollowUpCreate(db: Database, input: {
    row: typeof schema.followUps.$inferInsert;
    customer: Customer;
    confirmed: boolean;
    ipAddress: string | null;
    userAgent: string | null;
}) {
    const { row, customer, ipAddress, userAgent } = input;
    const now = row.createdAt;
    const valid = row.isValidFollowUp === 1;
    const taskId = crypto.randomUUID();
    const selectedTask = sql `(SELECT id FROM tasks WHERE customer_id = ${customer.id}
    AND type = 'follow_up' AND status = 'open' ORDER BY created_at, id LIMIT 1)`;
    const statements: [
        BatchItem<"sqlite">,
        ...BatchItem<"sqlite">[]
    ] = [
        db.insert(schema.followUps).values(row),
        db.update(schema.customers).set({
            lastFollowUpAt: row.followUpTime, updatedAt: now, updatedBy: row.userId,
            ...(valid ? { lastValidFollowUpAt: row.followUpTime, ...buildReclamationCycleResetFields(row.followUpTime) } : {}),
            ...(row.nextFollowUpAt ? { nextFollowUpAt: row.nextFollowUpAt } : {}),
        }).where(eq(schema.customers.id, customer.id)),
    ];
    if (valid && customer.ownerId === row.userId) {
        statements.push(db.update(schema.reclamationActionItems).set({
            actionState: "completed", completedAt: now, completedFollowUpId: row.id, updatedAt: now,
        }).where(and(eq(schema.reclamationActionItems.customerId, customer.id), eq(schema.reclamationActionItems.userId, row.userId), eq(schema.reclamationActionItems.cycleStartedAt, getReclamationCycleStartedAt(customer)), eq(schema.reclamationActionItems.actionState, "pending"))));
    }
    if (row.nextFollowUpAt) {
        const title = `跟进客户：${customer.customerName}`;
        const assignee = customer.ownerId ?? row.userId;
        // Evaluate task existence inside the transaction, not a racy preflight read.
        statements.push(db.insert(schema.tasks).select(sql `SELECT ${taskId}, ${customer.id},
      ${assignee}, ${row.userId}, ${title}, NULL, 'follow_up', 'open', ${row.nextFollowUpAt},
      NULL, ${now}, ${now} WHERE ${selectedTask} IS NULL`));
        statements.push(db.update(schema.tasks).set({
            dueAt: row.nextFollowUpAt, title, assignedTo: assignee, updatedAt: now,
        }).where(eq(schema.tasks.id, selectedTask)));
        statements.push(db.insert(schema.auditLogs).values({
            id: crypto.randomUUID(), userId: row.userId,
            action: sql `CASE WHEN ${selectedTask} = ${taskId} THEN 'task.created' ELSE 'task.updated' END`,
            entityType: "task", entityId: selectedTask, ipAddress, userAgent,
            metadata: JSON.stringify({ customerId: customer.id, dueAt: row.nextFollowUpAt }), createdAt: now,
        }));
    }
    const metadata = JSON.stringify({ customerId: customer.id, outcome: row.outcome,
        isValidFollowUp: valid, ...(input.confirmed ? { duplicateContentConfirmed: true } : {}) });
    statements.push(db.insert(schema.auditLogs).values({
        id: crypto.randomUUID(), userId: row.userId, action: "follow_up.created", entityType: "follow_up",
        entityId: row.id, ipAddress, userAgent, createdAt: now,
        metadata: sql `json_set(${metadata}, '$.taskId', ${row.nextFollowUpAt ? selectedTask : sql `NULL`})`,
    }));
    await db.batch(statements);
}
