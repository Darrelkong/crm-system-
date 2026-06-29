import { isCustomerAssignee } from "@/lib/customers/assignees";
import type { Database } from "@/lib/db";
import type { Customer } from "../../../drizzle/schema/customers";
import type { User } from "../../../drizzle/schema/users";
import {
  isArchivedCustomer,
  ARCHIVED_AUDIT_ACTIONS,
  ARCHIVED_CUSTOMER_MESSAGE,
} from "@/lib/customers/archived";

export type CustomerAccessOptions = {
  isAssignee?: boolean;
};

export async function resolveCustomerAccessOptions(
  db: Database,
  user: User,
  customerId: string,
): Promise<CustomerAccessOptions> {
  if (user.role === "admin") {
    return {};
  }

  const isAssignee = await isCustomerAssignee(db, customerId, user.id);
  return isAssignee ? { isAssignee: true } : {};
}

function isStaffOwnerOrAssignee(
  user: User,
  customer: Customer,
  options?: CustomerAccessOptions,
): boolean {
  return customer.ownerId === user.id || !!options?.isAssignee;
}

function assertCustomerNotArchived(
  customer: Customer,
  auditAction: string,
): void {
  if (isArchivedCustomer(customer)) {
    throw new PermissionError(400, ARCHIVED_CUSTOMER_MESSAGE, auditAction);
  }
}

export { assertCustomerNotArchived };

export type CustomerAccessLevel = "full" | "masked" | "archived_basic" | "denied";

export type CustomerView = {
  id: string;
  customerCode?: string | null;
  customerName: string;
  customerType: string;
  salesStage: string;
  source: string;
  status: string;
  ownerId: string | null;
  ownerName?: string | null;
  accessLevel: CustomerAccessLevel;
  isMasked: boolean;
  isArchived?: boolean;
  isPinned: boolean;
  pinnedAt?: string | null;
  // Sensitive — only present when accessLevel = "full"
  phoneCountryCode?: string | null;
  phone?: string | null;
  wechatId?: string | null;
  email?: string | null;
  sourceRemark?: string | null;
  requestedProjectName?: string | null;
  notes?: string | null;
  releaserUserId?: string | null;
  createdBy: string;
  createdByName?: string | null;
  updatedBy?: string | null;
  createdAt: string;
  updatedAt: string;
  lastFollowUpAt?: string | null;
  lastValidFollowUpAt?: string | null;
  nextFollowUpAt?: string | null;
  neverContacted: boolean;
  overdueFollowUp: boolean;
};

export class PermissionError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly auditAction?: string,
  ) {
    super(message);
    this.name = "PermissionError";
  }
}

/** Public pool: owner_id is null OR status is public_pool. */
export function isPublicPoolCustomer(customer: Customer): boolean {
  return customer.ownerId === null || customer.status === "public_pool";
}

/**
 * Returns the access level for a user against a customer.
 * - Admin: always full (including archived)
 * - Archived + Staff owner/assignee: archived_basic (non-sensitive fields only)
 * - Archived + Staff non-owner/non-assignee: denied
 * - Public pool: masked for all staff
 * - Staff own active customer or assignee: full
 */
export function getCustomerAccessLevel(
  user: User,
  customer: Customer,
  options?: CustomerAccessOptions,
): CustomerAccessLevel {
  if (user.role === "admin") {
    return "full";
  }

  if (isArchivedCustomer(customer)) {
    if (isStaffOwnerOrAssignee(user, customer, options)) {
      return "archived_basic";
    }
    return "denied";
  }

  if (isPublicPoolCustomer(customer)) {
    return "masked";
  }

  if (isStaffOwnerOrAssignee(user, customer, options)) {
    return "full";
  }

  return "denied";
}

export function assertCanAccessCustomer(
  user: User,
  customer: Customer,
  options?: CustomerAccessOptions,
): void {
  if (getCustomerAccessLevel(user, customer, options) === "denied") {
    throw new PermissionError(
      403,
      "无权访问该客户",
      "permission.denied.customer_access",
    );
  }
}

export function assertCanViewCustomerFullDetails(
  user: User,
  customer: Customer,
  options?: CustomerAccessOptions,
): void {
  if (getCustomerAccessLevel(user, customer, options) !== "full") {
    throw new PermissionError(
      403,
      "无权查看该客户完整资料",
      "permission.denied.customer_access",
    );
  }
}

/** AI insight requires full access — same bar as follow-up records and sensitive fields. */
export function assertCanViewCustomerAiInsight(
  user: User,
  customer: Customer,
  options?: CustomerAccessOptions,
): void {
  if (getCustomerAccessLevel(user, customer, options) !== "full") {
    throw new PermissionError(
      403,
      "无权查看该客户 AI 洞察",
      "permission.denied.customer_ai_insight",
    );
  }
}

export function assertCanEditCustomer(user: User, customer: Customer): void {
  assertCustomerNotArchived(customer, ARCHIVED_AUDIT_ACTIONS.update);

  if (user.role === "admin") {
    return;
  }

  if (isPublicPoolCustomer(customer)) {
    throw new PermissionError(
      403,
      "无权编辑公共池客户",
      "permission.denied.customer_edit",
    );
  }

  if (customer.ownerId !== user.id) {
    throw new PermissionError(
      403,
      "无权编辑该客户",
      "permission.denied.customer_edit",
    );
  }
}

/** Staff cannot change customer status via the general edit PATCH. */
export function assertStaffCannotChangeCustomerStatus(
  user: User,
  customer: Customer,
  body: Record<string, unknown>,
): void {
  if (user.role === "admin") {
    return;
  }
  if (
    typeof body.status === "string" &&
    body.status !== customer.status
  ) {
    throw new PermissionError(
      403,
      "员工不能通过编辑修改客户状态",
      "permission.denied.customer_status_change",
    );
  }
}

/** Public pool status can only be set via release-to-pool API, not general PATCH. */
export function assertPublicPoolRequiresReleaseFlow(
  customer: Customer,
  body: Record<string, unknown>,
): void {
  if (
    typeof body.status === "string" &&
    body.status === "public_pool" &&
    customer.status !== "public_pool"
  ) {
    throw new PermissionError(
      400,
      "不能通过普通编辑将状态设为公共池，请使用释放到公共池流程",
      "PUBLIC_POOL_REQUIRES_RELEASE_FLOW",
    );
  }
}

export function canEditCustomer(user: User, customer: Customer): boolean {
  if (isArchivedCustomer(customer)) return false;
  if (user.role === "admin") return true;
  if (isPublicPoolCustomer(customer)) return false;
  return customer.ownerId === user.id;
}

export function assertCanReleaseToPool(user: User, customer: Customer): void {
  assertCustomerNotArchived(customer, ARCHIVED_AUDIT_ACTIONS.releaseToPool);

  if (isPublicPoolCustomer(customer)) {
    throw new PermissionError(
      403,
      "客户已在公共池",
      "customer.release_to_pool_failed.permission_denied",
    );
  }

  if (user.role === "admin") return;

  if (customer.ownerId !== user.id) {
    throw new PermissionError(
      403,
      "无权释放该客户",
      "customer.release_to_pool_failed.permission_denied",
    );
  }
}

export function canReleaseToPool(user: User, customer: Customer): boolean {
  if (isArchivedCustomer(customer)) return false;
  try {
    assertCanReleaseToPool(user, customer);
    return true;
  } catch {
    return false;
  }
}

/** Admin all; staff owner or assignee; not public pool. */
export function assertCanAddFollowUp(
  user: User,
  customer: Customer,
  options?: CustomerAccessOptions,
): void {
  assertCustomerNotArchived(customer, ARCHIVED_AUDIT_ACTIONS.followUpCreate);

  if (user.role === "admin") return;

  if (isPublicPoolCustomer(customer)) {
    throw new PermissionError(
      403,
      "无权为该客户添加跟进",
      "permission.denied.follow_up_access",
    );
  }

  if (!isStaffOwnerOrAssignee(user, customer, options)) {
    throw new PermissionError(
      403,
      "无权为该客户添加跟进",
      "permission.denied.follow_up_access",
    );
  }
}

export function canAddFollowUp(
  user: User,
  customer: Customer,
  options?: CustomerAccessOptions,
): boolean {
  if (isArchivedCustomer(customer)) return false;
  try {
    assertCanAddFollowUp(user, customer, options);
    return true;
  } catch {
    return false;
  }
}

export function assertCanViewFollowUps(
  user: User,
  customer: Customer,
  options?: CustomerAccessOptions,
): void {
  if (isArchivedCustomer(customer)) {
    if (user.role === "admin") return;
    throw new PermissionError(
      403,
      "无权查看已归档客户的跟进记录",
      "permission.denied.follow_up_access",
    );
  }

  if (getCustomerAccessLevel(user, customer, options) !== "full") {
    throw new PermissionError(
      403,
      "无权查看该客户跟进记录",
      "permission.denied.follow_up_access",
    );
  }
}

/** Follow-up list metadata (non-sensitive). */
export function getCustomerFollowUpMeta(
  customer: Customer,
  now = new Date().toISOString(),
) {
  return {
    lastFollowUpAt: customer.lastFollowUpAt ?? null,
    lastValidFollowUpAt: customer.lastValidFollowUpAt ?? null,
    nextFollowUpAt: customer.nextFollowUpAt ?? null,
    neverContacted: !customer.lastValidFollowUpAt,
    overdueFollowUp: !!(
      customer.nextFollowUpAt && customer.nextFollowUpAt < now
    ),
  };
}

/** Staff view with sensitive fields removed. */
export function maskCustomerForStaff(customer: Customer): CustomerView {
  return {
    id: customer.id,
    customerName: customer.customerName,
    customerType: customer.customerType,
    salesStage: customer.salesStage,
    source: customer.source,
    status: customer.status,
    ownerId: customer.ownerId,
    accessLevel: "masked",
    isMasked: true,
    isPinned: customer.isPinned === 1,
    pinnedAt: customer.pinnedAt ?? null,
    createdBy: customer.createdBy,
    updatedBy: customer.updatedBy,
    createdAt: customer.createdAt,
    updatedAt: customer.updatedAt,
    requestedProjectName: customer.requestedProjectName,
    ...getCustomerFollowUpMeta(customer),
  };
}

export function toCustomerFullView(customer: Customer): CustomerView {
  return {
    id: customer.id,
    customerCode: customer.customerCode,
    customerName: customer.customerName,
    customerType: customer.customerType,
    salesStage: customer.salesStage,
    source: customer.source,
    status: customer.status,
    ownerId: customer.ownerId,
    accessLevel: "full",
    isMasked: false,
    isPinned: customer.isPinned === 1,
    pinnedAt: customer.pinnedAt ?? null,
    phoneCountryCode: customer.phoneCountryCode,
    phone: customer.phone,
    wechatId: customer.wechatId,
    email: customer.email,
    sourceRemark: customer.sourceRemark,
    requestedProjectName: customer.requestedProjectName,
    notes: customer.notes,
    releaserUserId: customer.releaserUserId,
    createdBy: customer.createdBy,
    updatedBy: customer.updatedBy,
    createdAt: customer.createdAt,
    updatedAt: customer.updatedAt,
    ...getCustomerFollowUpMeta(customer),
  };
}

export function formatCustomerForUser(
  user: User,
  customer: Customer,
  options?: CustomerAccessOptions,
): CustomerView {
  const level = getCustomerAccessLevel(user, customer, options);

  if (level === "denied") {
    throw new PermissionError(
      403,
      "无权访问该客户",
      "permission.denied.customer_access",
    );
  }

  if (level === "full") {
    const view = toCustomerFullView(customer);
    if (isArchivedCustomer(customer)) {
      return withCustomerCodeVisibility(user, { ...view, isArchived: true });
    }
    return withCustomerCodeVisibility(user, view);
  }

  if (level === "archived_basic") {
    return withCustomerCodeVisibility(user, {
      ...maskCustomerForStaff(customer),
      isArchived: true,
      accessLevel: "archived_basic",
    });
  }

  return withCustomerCodeVisibility(user, maskCustomerForStaff(customer));
}

function withCustomerCodeVisibility(user: User, view: CustomerView): CustomerView {
  if (user.role === "admin") {
    return view;
  }
  const { customerCode, ...rest } = view;
  void customerCode;
  return rest;
}

/**
 * SQL list scope for staff: own customers + public pool entries.
 * Admin returns null (no filter).
 */
export function getCustomerListScope(user: User): {
  ownerId?: string;
  includePublicPool: boolean;
} | null {
  if (user.role === "admin") {
    return null;
  }

  return {
    ownerId: user.id,
    includePublicPool: true,
  };
}
