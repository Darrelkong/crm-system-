import type { Customer } from "../../../../drizzle/schema/customers";
import type { User } from "../../../../drizzle/schema/users";
import { isArchivedCustomer } from "@/lib/customers/archived";
import {
  assertCanEditCustomer,
  getCustomerAccessLevel,
  isPublicPoolCustomer,
  PermissionError,
} from "@/lib/permissions/customers";
import { FAMILY_ERROR_CODES, FamilyLinkError } from "./errors";

function isEligibleFamilyCustomer(customer: Customer): boolean {
  return (
    customer.customerType === "individual" &&
    customer.deletedAt == null &&
    !isArchivedCustomer(customer)
  );
}

export function canManageCustomerFamily(user: User, customer: Customer): boolean {
  if (!isEligibleFamilyCustomer(customer)) {
    return false;
  }

  try {
    assertCanEditCustomer(user, customer);
    return true;
  } catch {
    return false;
  }
}

export function assertCanManageCustomerFamily(
  user: User,
  customer: Customer,
): void {
  if (!isEligibleFamilyCustomer(customer)) {
    throw new FamilyLinkError(
      400,
      "当前客户无法管理家庭成员",
      FAMILY_ERROR_CODES.SOURCE_NOT_ELIGIBLE,
    );
  }

  try {
    assertCanEditCustomer(user, customer);
  } catch (error) {
    if (error instanceof PermissionError) {
      throw new FamilyLinkError(
        error.status,
        error.message,
        FAMILY_ERROR_CODES.SOURCE_NOT_ELIGIBLE,
      );
    }
    throw error;
  }
}

export function assertFamilyTargetEligible(customer: Customer): void {
  if (customer.deletedAt) {
    throw new FamilyLinkError(
      404,
      "目标客户不存在",
      FAMILY_ERROR_CODES.TARGET_NOT_FOUND,
    );
  }

  if (customer.customerType !== "individual") {
    throw new FamilyLinkError(
      400,
      "公司客户不能作为家庭成员",
      FAMILY_ERROR_CODES.TARGET_NOT_ELIGIBLE,
    );
  }

  if (isArchivedCustomer(customer)) {
    throw new FamilyLinkError(
      400,
      "归档客户不能建立新的家庭关联",
      FAMILY_ERROR_CODES.TARGET_NOT_ELIGIBLE,
    );
  }
}

export function canDirectLinkFamilyTarget(
  user: User,
  target: Customer,
  isAssignee: boolean,
): boolean {
  if (user.role === "admin") {
    return isEligibleFamilyCustomer(target);
  }

  if (!isEligibleFamilyCustomer(target) || isPublicPoolCustomer(target)) {
    return false;
  }

  return getCustomerAccessLevel(user, target, { isAssignee }) === "full" &&
    target.ownerId === user.id;
}

export function resolveFamilyLinkMode(
  user: User,
  target: Customer,
  isAssignee: boolean,
): "direct" | "approval" {
  return canDirectLinkFamilyTarget(user, target, isAssignee)
    ? "direct"
    : "approval";
}
