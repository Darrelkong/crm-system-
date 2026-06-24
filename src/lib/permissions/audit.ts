import { writeAuditLog } from "@/lib/audit/audit-log";
import { getRequestMeta } from "@/lib/auth/cookies";

export async function logPermissionDenied(
  request: Request,
  input: {
    action: string;
    userId?: string | null;
    entityType?: string | null;
    entityId?: string | null;
    metadata?: Record<string, unknown> | null;
  },
): Promise<void> {
  const { ipAddress, userAgent } = getRequestMeta(request);
  await writeAuditLog({
    userId: input.userId ?? null,
    action: input.action,
    entityType: input.entityType ?? null,
    entityId: input.entityId ?? null,
    ipAddress,
    userAgent,
    metadata: input.metadata ?? null,
  });
}
