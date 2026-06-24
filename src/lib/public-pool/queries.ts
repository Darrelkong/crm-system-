import { asc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import type { Customer } from "../../../drizzle/schema/customers";
import type { User } from "../../../drizzle/schema/users";
import {
  formatCustomerForUser,
} from "@/lib/permissions/customers";
import { getStaffClaimStatus } from "./claim-limits";
import type { StaffClaimStatus } from "./constants";

export type PublicPoolCustomerView = {
  id: string;
  customerName: string;
  customerType: string;
  source: string;
  salesStage: string;
  poolEnteredAt: string | null;
  poolReason: string | null;
  accessLevel: "full" | "masked";
  isMasked: boolean;
  canClaim: boolean;
  claimBlockedReason: string | null;
  phone?: string | null;
  wechatId?: string | null;
  email?: string | null;
  notes?: string | null;
  sourceRemark?: string | null;
};

function getReleasedById(customer: Customer): string | null {
  return customer.releasedBy ?? customer.releaserUserId ?? null;
}

export function evaluateCustomerClaimEligibility(
  user: User,
  customer: Customer,
  staffStatus: StaffClaimStatus | null,
): { canClaim: boolean; claimBlockedReason: string | null } {
  if (customer.status !== "public_pool") {
    return {
      canClaim: false,
      claimBlockedReason: "客户不在公共池",
    };
  }

  if (user.role === "admin") {
    return { canClaim: true, claimBlockedReason: null };
  }

  const releasedBy = getReleasedById(customer);
  if (releasedBy === user.id) {
    return {
      canClaim: false,
      claimBlockedReason: "不能领取自己释放到公共池的客户",
    };
  }

  if (!staffStatus) {
    return { canClaim: false, claimBlockedReason: "无法获取领取状态" };
  }

  if (staffStatus.inCooldown) {
    return {
      canClaim: false,
      claimBlockedReason: "当前处于领取冷却期，请稍后再试",
    };
  }

  if (staffStatus.remainingQuota <= 0) {
    return {
      canClaim: false,
      claimBlockedReason: "7 天领取名额已达上限",
    };
  }

  return { canClaim: true, claimBlockedReason: null };
}

export function formatPublicPoolCustomer(
  user: User,
  customer: Customer,
  claim: { canClaim: boolean; claimBlockedReason: string | null },
): PublicPoolCustomerView {
  const base = formatCustomerForUser(user, customer);

  return {
    id: base.id,
    customerName: base.customerName,
    customerType: base.customerType,
    source: base.source,
    salesStage: base.salesStage,
    poolEnteredAt: customer.poolEnteredAt ?? null,
    poolReason: customer.poolReason ?? null,
    accessLevel: base.accessLevel === "denied" ? "masked" : base.accessLevel,
    isMasked: base.isMasked,
    canClaim: claim.canClaim,
    claimBlockedReason: claim.claimBlockedReason,
    phone: base.phone,
    wechatId: base.wechatId,
    email: base.email,
    notes: base.notes,
    sourceRemark: base.sourceRemark,
  };
}

export async function listPublicPoolCustomers() {
  const db = getDb();
  return db
    .select()
    .from(schema.customers)
    .where(eq(schema.customers.status, "public_pool"))
    .orderBy(asc(schema.customers.poolEnteredAt));
}

export async function formatPublicPoolListForUser(user: User) {
  const customers = await listPublicPoolCustomers();
  const staffStatus =
    user.role === "staff" ? await getStaffClaimStatus(user.id) : null;

  return customers.map((customer) => {
    const claim = evaluateCustomerClaimEligibility(
      user,
      customer,
      staffStatus,
    );
    return formatPublicPoolCustomer(user, customer, claim);
  });
}
