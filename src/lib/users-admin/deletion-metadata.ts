export type UserDeletionMetadata = {
  deleted_by_name: string | null;
  transferred_customer_count: number | null;
  transferred_to_admin_name: string | null;
  primary_assignees_transferred_count: number | null;
  collaborator_assignees_removed_count: number | null;
};

const EMPTY_DELETION_METADATA: UserDeletionMetadata = {
  deleted_by_name: null,
  transferred_customer_count: null,
  transferred_to_admin_name: null,
  primary_assignees_transferred_count: null,
  collaborator_assignees_removed_count: null,
};

function parseOptionalCount(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function parseUserDeletionMetadata(
  raw: string | null | undefined,
): UserDeletionMetadata {
  if (!raw) {
    return { ...EMPTY_DELETION_METADATA };
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      deleted_by_name:
        typeof parsed.deletedByName === "string" ? parsed.deletedByName : null,
      transferred_customer_count: parseOptionalCount(
        parsed.transferredCustomerCount,
      ),
      transferred_to_admin_name:
        typeof parsed.transferredToAdminName === "string"
          ? parsed.transferredToAdminName
          : null,
      primary_assignees_transferred_count: parseOptionalCount(
        parsed.primaryAssigneesTransferredCount,
      ),
      collaborator_assignees_removed_count: parseOptionalCount(
        parsed.collaboratorAssigneesRemovedCount,
      ),
    };
  } catch {
    return { ...EMPTY_DELETION_METADATA };
  }
}

export function buildUserDeletionAuditMetadata(input: {
  email: string;
  transferredCustomerCount: number;
  actor: { id: string; displayName: string };
}) {
  return {
    email: input.email,
    transferredCustomerCount: input.transferredCustomerCount,
    deletedById: input.actor.id,
    deletedByName: input.actor.displayName,
    transferredToAdminId: input.actor.id,
    transferredToAdminName: input.actor.displayName,
  };
}
