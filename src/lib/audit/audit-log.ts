import { getDb, type Database } from "@/lib/db";
import { schema } from "@/lib/db";

type AuditLogInput = {
  userId?: string | null;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown> | null;
};

export async function writeAuditLog(
  input: AuditLogInput,
  db?: Database,
): Promise<void> {
  const database = db ?? getDb();
  await database.insert(schema.auditLogs).values({
    id: crypto.randomUUID(),
    userId: input.userId ?? null,
    action: input.action,
    entityType: input.entityType ?? null,
    entityId: input.entityId ?? null,
    ipAddress: input.ipAddress ?? null,
    userAgent: input.userAgent ?? null,
    metadata: input.metadata ? JSON.stringify(input.metadata) : null,
    createdAt: new Date().toISOString(),
  });
}
