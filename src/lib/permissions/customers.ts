import type { Customer } from "../../../drizzle/schema/customers";
import type { User } from "../../../drizzle/schema/users";

export type CustomerAccessLevel = "full" | "masked" | "denied";

export type CustomerView = {
  id: string;
  customerName: string;
  customerType: string;
  salesStage: string;
  source: string;
  status: string;
  ownerId: string | null;
  accessLevel: CustomerAccessLevel;
  isMasked: boolean;
  // Sensitive — only present when accessLevel = "full"
  phoneCountryCode?: string | null;
  phone?: string | null;
  wechatId?: string | null;
  email?: string | null;
  sourceRemark?: string | null;
  notes?: string | null;
  releaserUserId?: string | null;
  createdBy: string;
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
 * - Admin: always full
 * - Staff own customer: full
 * - Staff other employee customer: denied
 * - Public pool: masked for all staff (including releaser)
 */
export function getCustomerAccessLevel(
  user: User,
  customer: Customer,
): CustomerAccessLevel {
  if (user.role === "admin") {
    return "full";
  }

  if (isPublicPoolCustomer(customer)) {
    return "masked";
  }

  if (customer.ownerId === user.id) {
    return "full";
  }

  return "denied";
}

export function assertCanAccessCustomer(user: User, customer: Customer): void {
  if (getCustomerAccessLevel(user, customer) === "denied") {
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
): void {
  if (getCustomerAccessLevel(user, customer) !== "full") {
    throw new PermissionError(
      403,
      "无权查看该客户完整资料",
      "permission.denied.customer_access",
    );
  }
}

export function assertCanEditCustomer(user: User, customer: Customer): void {
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

export function canEditCustomer(user: User, customer: Customer): boolean {
  if (user.role === "admin") return true;
  if (isPublicPoolCustomer(customer)) return false;
  return customer.ownerId === user.id;
}

export function assertCanReleaseToPool(user: User, customer: Customer): void {
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
  try {
    assertCanReleaseToPool(user, customer);
    return true;
  } catch {
    return false;
  }
}

/** Same scope as edit: admin all, staff own only, not public pool. */
export function assertCanAddFollowUp(user: User, customer: Customer): void {
  if (user.role === "admin") return;

  if (isPublicPoolCustomer(customer)) {
    throw new PermissionError(
      403,
      "无权为该客户添加跟进",
      "permission.denied.follow_up_access",
    );
  }

  if (customer.ownerId !== user.id) {
    throw new PermissionError(
      403,
      "无权为该客户添加跟进",
      "permission.denied.follow_up_access",
    );
  }
}

export function canAddFollowUp(user: User, customer: Customer): boolean {
  try {
    assertCanAddFollowUp(user, customer);
    return true;
  } catch {
    return false;
  }
}

export function assertCanViewFollowUps(user: User, customer: Customer): void {
  if (getCustomerAccessLevel(user, customer) !== "full") {
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
    createdBy: customer.createdBy,
    updatedBy: customer.updatedBy,
    createdAt: customer.createdAt,
    updatedAt: customer.updatedAt,
    ...getCustomerFollowUpMeta(customer),
  };
}

export function toCustomerFullView(customer: Customer): CustomerView {
  return {
    id: customer.id,
    customerName: customer.customerName,
    customerType: customer.customerType,
    salesStage: customer.salesStage,
    source: customer.source,
    status: customer.status,
    ownerId: customer.ownerId,
    accessLevel: "full",
    isMasked: false,
    phoneCountryCode: customer.phoneCountryCode,
    phone: customer.phone,
    wechatId: customer.wechatId,
    email: customer.email,
    sourceRemark: customer.sourceRemark,
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
): CustomerView {
  const level = getCustomerAccessLevel(user, customer);

  if (level === "denied") {
    throw new PermissionError(
      403,
      "无权访问该客户",
      "permission.denied.customer_access",
    );
  }

  if (level === "full") {
    return toCustomerFullView(customer);
  }

  return maskCustomerForStaff(customer);
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
