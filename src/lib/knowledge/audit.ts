import { getDb, schema, type Database } from "@/lib/db";

export type KnowledgeAuditAction =
  | "knowledge.bootstrap"
  | "knowledge.unlock_success"
  | "knowledge.unlock_failed"
  | "knowledge.lock"
  | "knowledge.password_change"
  | "knowledge.role_change";

export type KnowledgeAuditInput = {
  userId: string;
  action: KnowledgeAuditAction;
  entityType: string;
  entityId: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown>;
};

export function buildKnowledgeAuditInsert(
  db: Database,
  input: KnowledgeAuditInput,
 ) {
  return db
    .insert(schema.auditLogs)
    .values({
      id: crypto.randomUUID(),
      userId: input.userId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
      metadata: input.metadata ? JSON.stringify(input.metadata) : null,
      createdAt: new Date().toISOString(),
    });
}

export async function writeKnowledgeAudit(
  input: KnowledgeAuditInput,
  db?: Database,
): Promise<void> {
  const database = db ?? getDb();
  await database.insert(schema.auditLogs).values({
    id: crypto.randomUUID(),
    userId: input.userId,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    ipAddress: input.ipAddress ?? null,
    userAgent: input.userAgent ?? null,
    metadata: input.metadata ? JSON.stringify(input.metadata) : null,
    createdAt: new Date().toISOString(),
  });
}
