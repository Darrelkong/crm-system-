export type AuditLogListItem = {
  id: string;
  userId: string | null;
  userName: string | null;
  userEmail: string | null;
  action: string;
  entityType: string | null;
  entityId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
};

export type AuditLogListResponse = {
  ok: true;
  items: AuditLogListItem[];
  nextCursor: string | null;
};

export type AuditLogListFilters = {
  action?: string;
  entityType?: string;
  entityId?: string;
  userId?: string;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
  cursor?: string;
};
