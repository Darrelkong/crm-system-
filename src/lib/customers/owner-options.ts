import type { User } from "../../../drizzle/schema/users";

export type CustomerOwnerOption = {
  id: string;
  displayName: string;
  role: User["role"];
};

type StaffOwnerCandidate = Pick<User, "id" | "displayName">;

export function formatCustomerOwnerOptionLabel(
  owner: CustomerOwnerOption,
  adminRoleLabel: string,
): string {
  return owner.role === "admin"
    ? `${owner.displayName}（${adminRoleLabel}）`
    : owner.displayName;
}

/**
 * Admin-only owner options for customer creation.
 *
 * The current admin is intentionally first so the form defaults to the
 * authenticated actor while still allowing an admin to select active Staff.
 */
export function buildCustomerOwnerOptions(
  currentUser: Pick<User, "id" | "displayName" | "role">,
  staffUsers: StaffOwnerCandidate[],
): CustomerOwnerOption[] {
  if (currentUser.role !== "admin") {
    return [];
  }

  return [
    {
      id: currentUser.id,
      displayName: currentUser.displayName,
      role: "admin",
    },
    ...staffUsers
      .filter((user) => user.id !== currentUser.id)
      .map((user) => ({
        id: user.id,
        displayName: user.displayName,
        role: "staff" as const,
      })),
  ];
}
