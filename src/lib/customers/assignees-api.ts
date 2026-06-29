import type { Customer } from "../../../drizzle/schema/customers";
import type { User } from "../../../drizzle/schema/users";
import type { Database } from "@/lib/db";
import { listActiveStaffUsers } from "@/lib/users/queries";
import { getUserById } from "@/lib/users/queries";
import {
  listCustomerAssignees,
  type CustomerAssigneeRecord,
} from "@/lib/customers/assignees";
import {
  applyCollaboratorAssignees,
  assertCustomerCollaboratorsMutable,
  AssigneeMutationError,
  type AssigneeMutationErrorCode,
} from "@/lib/customers/assignees-mutations";
import {
  assertCanManageCustomerAssignees,
  PermissionError,
  resolveCustomerAccessOptions,
  getCustomerAccessLevel,
} from "@/lib/permissions/customers";

export type AssigneeStaffSummary = {
  id: string;
  name: string;
  email: string;
};

export type CustomerAssigneesAdminPayload = {
  owner: AssigneeStaffSummary | null;
  collaborators: AssigneeStaffSummary[];
  availableStaff: AssigneeStaffSummary[];
  assignees: CustomerAssigneeRecord[];
};

export type AssigneesApiError = {
  status: number;
  message: string;
  errorCode: string;
};

export function mapAssigneeMutationErrorToApiCode(
  code: AssigneeMutationErrorCode,
): string {
  switch (code) {
    case "INVALID_COLLABORATOR_IDS":
    case "COLLABORATOR_USER_NOT_STAFF":
      return "ASSIGNEE_INVALID_PAYLOAD";
    case "COLLABORATOR_INCLUDES_OWNER":
      return "ASSIGNEE_OWNER_NOT_ALLOWED";
    case "COLLABORATOR_INCLUDES_ADMIN":
      return "ASSIGNEE_ADMIN_NOT_ALLOWED";
    case "COLLABORATOR_USER_INACTIVE":
    case "COLLABORATOR_USER_DELETED":
      return "ASSIGNEE_INACTIVE_USER";
    case "COLLABORATOR_USER_NOT_FOUND":
      return "ASSIGNEE_USER_NOT_FOUND";
    case "CUSTOMER_NOT_FOUND":
      return "CUSTOMER_NOT_FOUND";
    default:
      return "SERVER_ERROR";
  }
}

function toStaffSummary(
  user: Pick<User, "id" | "displayName" | "email">,
): AssigneeStaffSummary {
  return {
    id: user.id,
    name: user.displayName,
    email: user.email,
  };
}

async function resolveStaffSummaries(
  db: Database,
  userIds: string[],
): Promise<AssigneeStaffSummary[]> {
  if (userIds.length === 0) {
    return [];
  }

  const summaries: AssigneeStaffSummary[] = [];
  for (const userId of userIds) {
    const user = await getUserById(userId);
    if (user) {
      summaries.push(toStaffSummary(user));
    }
  }
  return summaries;
}

export async function buildCustomerAssigneesAdminPayload(
  db: Database,
  customer: Customer,
): Promise<CustomerAssigneesAdminPayload> {
  const assignees = await listCustomerAssignees(db, customer.id);
  const collaborators = assignees.filter((row) => row.role === "collaborator");

  const owner = customer.ownerId ? await getUserById(customer.ownerId) : null;
  const activeStaff = await listActiveStaffUsers();

  const availableStaff = activeStaff
    .filter((staff) => staff.id !== customer.ownerId)
    .map(toStaffSummary)
    .sort((a, b) => a.name.localeCompare(b.name, "zh-Hant"));

  const collaboratorSummaries = await resolveStaffSummaries(
    db,
    collaborators.map((row) => row.userId),
  );

  return {
    owner: owner ? toStaffSummary(owner) : null,
    collaborators: collaboratorSummaries,
    availableStaff,
    assignees,
  };
}

export function assertCanAdminManageAssignees(
  user: User,
  customer: Customer,
): void {
  assertCanManageCustomerAssignees(user, customer);
}

export async function getCustomerAssigneesAdminPayload(
  db: Database,
  user: User,
  customer: Customer,
): Promise<CustomerAssigneesAdminPayload> {
  assertCanAdminManageAssignees(user, customer);
  await assertCustomerCollaboratorsMutable(db, customer.id);
  return buildCustomerAssigneesAdminPayload(db, customer);
}

export async function updateCustomerCollaborators(
  db: Database,
  user: User,
  customer: Customer,
  body: unknown,
): Promise<CustomerAssigneesAdminPayload> {
  assertCanAdminManageAssignees(user, customer);
  await assertCustomerCollaboratorsMutable(db, customer.id);

  const input =
    body && typeof body === "object" && "collaboratorUserIds" in body
      ? (body as { collaboratorUserIds: unknown }).collaboratorUserIds
      : body;

  try {
    await applyCollaboratorAssignees(db, {
      customerId: customer.id,
      collaboratorUserIds: input,
      assignedBy: user.id,
    });
  } catch (error) {
    if (error instanceof AssigneeMutationError) {
      throw {
        status: error.code === "CUSTOMER_NOT_FOUND" ? 404 : 400,
        message: error.message,
        errorCode: mapAssigneeMutationErrorToApiCode(error.code),
      } satisfies AssigneesApiError;
    }
    throw error;
  }

  return buildCustomerAssigneesAdminPayload(db, customer);
}

export function toAssigneesPermissionError(error: unknown): AssigneesApiError | null {
  if (!(error instanceof PermissionError)) {
    return null;
  }

  if (error.auditAction === "permission.denied.pending_on_hold_create") {
    return {
      status: 403,
      message: error.message,
      errorCode: "PENDING_ON_HOLD_CREATE",
    };
  }

  if (error.auditAction === "permission.denied.customer_assignees_manage") {
    return {
      status: 403,
      message: error.message,
      errorCode: "CUSTOMER_ASSIGNEES_FORBIDDEN",
    };
  }

  if (error.auditAction === "customer.assignees.manage_failed.archived") {
    return {
      status: error.status,
      message: error.message,
      errorCode: "CUSTOMER_ASSIGNEES_FORBIDDEN",
    };
  }

  return {
    status: error.status,
    message: error.message,
    errorCode: error.auditAction ?? "INSUFFICIENT_PERMISSIONS",
  };
}

/** Verifies D-2c collaborator access after assignee update. */
export async function resolveCollaboratorAccessLevel(
  db: Database,
  customer: Customer,
  collaboratorUserId: string,
): Promise<"full" | "denied"> {
  const options = await resolveCustomerAccessOptions(
    db,
    { id: collaboratorUserId, role: "staff" } as User,
    customer.id,
  );
  const level = getCustomerAccessLevel(
    { id: collaboratorUserId, role: "staff" } as User,
    customer,
    options,
  );
  return level === "full" ? "full" : "denied";
}
