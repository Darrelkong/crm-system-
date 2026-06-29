import { eq } from "drizzle-orm";
import { writeAuditLog } from "@/lib/audit/audit-log";
import { writeFieldChangeLogEntry } from "@/lib/customers/field-change-log";
import { schema, type Database } from "@/lib/db";
import type { Customer } from "../../../drizzle/schema/customers";
import type { User } from "../../../drizzle/schema/users";

export const DEFAULT_ADMIN_ARCHIVE_REASON = "Admin archived customer";

export type ArchiveCustomerSource = "admin_patch";

export class ArchiveCustomerError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
  ) {
    super(message);
    this.name = "ArchiveCustomerError";
  }
}

export type ArchiveCustomerToRecycleBinInput = {
  customer: Customer;
  actor: User;
  reason?: string | null;
  now?: string;
  source: ArchiveCustomerSource;
  ipAddress?: string | null;
  userAgent?: string | null;
  auditAction?: string;
  extraAuditMetadata?: Record<string, unknown>;
};

export type ArchiveCustomerResult = {
  id: string;
  deletedAt: string;
  skipped: boolean;
};

export async function archiveCustomerToRecycleBin(
  db: Database,
  input: ArchiveCustomerToRecycleBinInput,
): Promise<ArchiveCustomerResult> {
  const { customer, actor } = input;

  if (customer.status === "archived" && customer.deletedAt) {
    return {
      id: customer.id,
      deletedAt: customer.deletedAt,
      skipped: true,
    };
  }

  const now = input.now ?? new Date().toISOString();
  const previousStatus = customer.status;
  const deletedAt = customer.deletedAt ?? now;
  const deletedBy = customer.deletedBy ?? actor.id;
  const deletedReason =
    customer.deletedReason ??
    (input.reason?.trim() || DEFAULT_ADMIN_ARCHIVE_REASON);

  await db
    .update(schema.customers)
    .set({
      status: "archived",
      deletedAt,
      deletedBy,
      deletedReason,
      updatedBy: actor.id,
      updatedAt: now,
    })
    .where(eq(schema.customers.id, customer.id));

  if (previousStatus !== "archived") {
    await writeFieldChangeLogEntry(
      customer.id,
      "status",
      previousStatus,
      "archived",
      actor.id,
    );
  }

  await writeAuditLog(
    {
      userId: actor.id,
      action: input.auditAction ?? "customer.deleted.soft",
      entityType: "customer",
      entityId: customer.id,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
      metadata: {
        customerName: customer.customerName,
        source: input.source,
        deletedAt,
        deletedReason,
        ...input.extraAuditMetadata,
      },
    },
    db,
  );

  return {
    id: customer.id,
    deletedAt,
    skipped: false,
  };
}
