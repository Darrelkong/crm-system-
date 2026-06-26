import { and, desc, eq, isNotNull, lt } from "drizzle-orm";
import { getDb, schema, type Database } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit/audit-log";
import { writeFieldChangeLogEntry } from "@/lib/customers/field-change-log";
import { getCustomerById } from "@/lib/customers/queries";
import {
  RECYCLE_BIN_PURGE_BATCH_SIZE,
  getRecycleBinRetentionCutoffIso,
} from "@/lib/recycle-bin/constants";
import type { Customer, CustomerStatus } from "../../../drizzle/schema/customers";
import type { User } from "../../../drizzle/schema/users";

export type PermanentDeleteSource = "manual" | "cron";

export type RecycleBinPurgeResult = {
  scannedCount: number;
  deletedCount: number;
  skippedCount: number;
  errors: Array<{ customerId: string; message: string }>;
};

const RESTORABLE_STATUSES = new Set<CustomerStatus>(["active", "inactive"]);

export class RecycleBinError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
  ) {
    super(message);
    this.name = "RecycleBinError";
  }
}

async function resolveRestoreStatus(customerId: string): Promise<CustomerStatus> {
  const db = getDb();
  const rows = await db
    .select({ oldValue: schema.fieldChangeLogs.oldValue })
    .from(schema.fieldChangeLogs)
    .where(
      and(
        eq(schema.fieldChangeLogs.customerId, customerId),
        eq(schema.fieldChangeLogs.fieldName, "status"),
        eq(schema.fieldChangeLogs.newValue, "archived"),
      ),
    )
    .orderBy(desc(schema.fieldChangeLogs.changedAt))
    .limit(1);

  const prior = rows[0]?.oldValue;
  if (prior && RESTORABLE_STATUSES.has(prior as CustomerStatus)) {
    return prior as CustomerStatus;
  }
  return "active";
}

export async function restoreCustomerFromRecycleBin(
  actor: User,
  customerId: string,
  meta: { ipAddress?: string | null; userAgent?: string | null },
): Promise<{ id: string; status: CustomerStatus }> {
  const customer = await getCustomerById(customerId);
  if (!customer) {
    throw new RecycleBinError("not_found", "客户不存在", 404);
  }

  if (customer.status !== "archived" || !customer.deletedAt) {
    throw new RecycleBinError(
      "not_in_recycle_bin",
      "该客户不在回收站中",
    );
  }

  const restoreStatus = await resolveRestoreStatus(customerId);
  const now = new Date().toISOString();
  const db = getDb();

  await db
    .update(schema.customers)
    .set({
      status: restoreStatus,
      deletedAt: null,
      deletedBy: null,
      deletedReason: null,
      updatedBy: actor.id,
      updatedAt: now,
    })
    .where(
      and(
        eq(schema.customers.id, customerId),
        eq(schema.customers.status, "archived"),
        isNotNull(schema.customers.deletedAt),
      ),
    );

  await writeFieldChangeLogEntry(
    customerId,
    "status",
    "archived",
    restoreStatus,
    actor.id,
  );

  await writeAuditLog({
    userId: actor.id,
    action: "customer.restored",
    entityType: "customer",
    entityId: customerId,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
    metadata: {
      customerName: customer.customerName,
      restoredStatus: restoreStatus,
      previousDeletedAt: customer.deletedAt,
    },
  });

  return { id: customerId, status: restoreStatus };
}

function assertRecycleBinCustomer(customer: Customer): void {
  if (customer.status !== "archived" || !customer.deletedAt) {
    throw new RecycleBinError(
      "not_in_recycle_bin",
      "该客户不在回收站中，无法永久删除",
    );
  }
}

function buildPermanentDeleteAuditMetadata(
  customer: Customer,
  permanentDeletedBy: string | null,
  source: PermanentDeleteSource,
) {
  const permanentDeletedAt = new Date().toISOString();
  return {
    customerId: customer.id,
    customerName: customer.customerName,
    deletedAt: customer.deletedAt,
    deletedBy: customer.deletedBy,
    permanentDeletedBy,
    permanentDeletedAt,
    source,
  };
}

async function executePermanentDeleteInBatch(
  db: Database,
  customer: Customer,
  options: {
    userId: string | null;
    source: PermanentDeleteSource;
    ipAddress?: string | null;
    userAgent?: string | null;
  },
): Promise<void> {
  assertRecycleBinCustomer(customer);

  const now = new Date().toISOString();
  const auditMetadata = buildPermanentDeleteAuditMetadata(
    customer,
    options.userId,
    options.source,
  );

  const batchStatements = [
    db
      .delete(schema.approvals)
      .where(eq(schema.approvals.customerId, customer.id)),
    db
      .delete(schema.reclamationWarningLogs)
      .where(eq(schema.reclamationWarningLogs.customerId, customer.id)),
    db.insert(schema.auditLogs).values({
      id: crypto.randomUUID(),
      userId: options.userId,
      action: "customer.deleted.permanent",
      entityType: "customer",
      entityId: customer.id,
      ipAddress: options.ipAddress ?? null,
      userAgent: options.userAgent ?? null,
      metadata: JSON.stringify(auditMetadata),
      createdAt: now,
    }),
    db
      .delete(schema.customers)
      .where(
        and(
          eq(schema.customers.id, customer.id),
          eq(schema.customers.status, "archived"),
          isNotNull(schema.customers.deletedAt),
        ),
      ),
  ];

  await db.batch(
    batchStatements as unknown as Parameters<Database["batch"]>[0],
  );

  const stillExists = await db
    .select({ id: schema.customers.id })
    .from(schema.customers)
    .where(eq(schema.customers.id, customer.id))
    .limit(1);

  if (stillExists.length > 0) {
    throw new RecycleBinError(
      "delete_failed",
      "永久删除失败，客户可能已被恢复或不在回收站中",
    );
  }
}

export async function permanentlyDeleteCustomerFromRecycleBin(
  actor: User,
  customerId: string,
  meta: {
    ipAddress?: string | null;
    userAgent?: string | null;
    source?: PermanentDeleteSource;
  } = {},
): Promise<void> {
  const customer = await getCustomerById(customerId);
  if (!customer) {
    throw new RecycleBinError("not_found", "客户不存在", 404);
  }

  assertRecycleBinCustomer(customer);

  const db = getDb();
  await executePermanentDeleteInBatch(db, customer, {
    userId: actor.id,
    source: meta.source ?? "manual",
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });
}

export async function purgeExpiredRecycleBinCustomers(
  db: Database,
  options?: { batchSize?: number; now?: Date },
): Promise<RecycleBinPurgeResult> {
  const batchSize = options?.batchSize ?? RECYCLE_BIN_PURGE_BATCH_SIZE;
  const now = options?.now ?? new Date();
  const cutoff = getRecycleBinRetentionCutoffIso(now);

  const candidates = await db
    .select()
    .from(schema.customers)
    .where(
      and(
        eq(schema.customers.status, "archived"),
        isNotNull(schema.customers.deletedAt),
        lt(schema.customers.deletedAt, cutoff),
      ),
    )
    .limit(batchSize);

  const result: RecycleBinPurgeResult = {
    scannedCount: candidates.length,
    deletedCount: 0,
    skippedCount: 0,
    errors: [],
  };

  for (const customer of candidates) {
    try {
      if (customer.status !== "archived" || !customer.deletedAt) {
        result.skippedCount += 1;
        continue;
      }
      if (customer.deletedAt >= cutoff) {
        result.skippedCount += 1;
        continue;
      }

      await executePermanentDeleteInBatch(db, customer, {
        userId: null,
        source: "cron",
      });
      result.deletedCount += 1;
    } catch (error) {
      result.skippedCount += 1;
      result.errors.push({
        customerId: customer.id,
        message:
          error instanceof Error ? error.message : "Unknown permanent delete error",
      });
    }
  }

  return result;
}
