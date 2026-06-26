export type UserDeletionMetadata = {
  deleted_by_name: string | null;
  transferred_customer_count: number | null;
  transferred_to_admin_name: string | null;
};

export function parseUserDeletionMetadata(
  raw: string | null | undefined,
): UserDeletionMetadata {
  if (!raw) {
    return {
      deleted_by_name: null,
      transferred_customer_count: null,
      transferred_to_admin_name: null,
    };
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const count = parsed.transferredCustomerCount;
    return {
      deleted_by_name:
        typeof parsed.deletedByName === "string" ? parsed.deletedByName : null,
      transferred_customer_count:
        typeof count === "number" ? count : null,
      transferred_to_admin_name:
        typeof parsed.transferredToAdminName === "string"
          ? parsed.transferredToAdminName
          : null,
    };
  } catch {
    return {
      deleted_by_name: null,
      transferred_customer_count: null,
      transferred_to_admin_name: null,
    };
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
