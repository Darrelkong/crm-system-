import { asc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import type { Customer } from "../../../drizzle/schema/customers";
import type { User } from "../../../drizzle/schema/users";
import { formatCustomerForUser } from "@/lib/permissions/customers";
import { calculateDataCompletenessScore } from "@/lib/customers/scoring/completeness";
import { getCustomerIdsWithFollowUps } from "@/lib/customers/scoring/service";
import {
  maskPublicPoolCustomerName,
  truncatePoolReason,
} from "@/lib/public-pool/display";
import { getStaffClaimStatus } from "./claim-limits";
import {
  SELF_RELEASE_CLAIM_BLOCK_DAYS,
  type StaffClaimStatus,
} from "./constants";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MS_PER_HOUR = 60 * 60 * 1000;

export type SelfReleaseClaimBlockState = {
  blocked: boolean;
  releasedBy: string;
  poolEnteredAt: string;
  blockedUntil: string;
  blockDays: number;
  remainingHours: number | null;
  remainingDays: number | null;
};

export function getSelfReleaseClaimBlockState(
  customer: Customer,
  userId: string,
  now: Date = new Date(),
): SelfReleaseClaimBlockState | null {
  const releasedBy = getReleasedById(customer);
  if (!releasedBy || releasedBy !== userId) {
    return null;
  }

  const poolEnteredAt = customer.poolEnteredAt;
  if (!poolEnteredAt) {
    return {
      blocked: false,
      releasedBy,
      poolEnteredAt: "",
      blockedUntil: "",
      blockDays: SELF_RELEASE_CLAIM_BLOCK_DAYS,
      remainingHours: null,
      remainingDays: null,
    };
  }

  const blockedUntil = new Date(
    new Date(poolEnteredAt).getTime() +
      SELF_RELEASE_CLAIM_BLOCK_DAYS * MS_PER_DAY,
  );
  const blocked = blockedUntil > now;
  const remainingMs = blocked ? blockedUntil.getTime() - now.getTime() : 0;

  return {
    blocked,
    releasedBy,
    poolEnteredAt,
    blockedUntil: blockedUntil.toISOString(),
    blockDays: SELF_RELEASE_CLAIM_BLOCK_DAYS,
    remainingHours: blocked ? Math.ceil(remainingMs / MS_PER_HOUR) : null,
    remainingDays: blocked ? Math.ceil(remainingMs / MS_PER_DAY) : null,
  };
}

function selfReleaseBlockParams(
  state: SelfReleaseClaimBlockState,
): Record<string, string> {
  const params: Record<string, string> = {
    blockDays: String(state.blockDays),
    releasedBy: state.releasedBy,
    poolEnteredAt: state.poolEnteredAt,
    blockedUntil: state.blockedUntil,
  };
  if (state.remainingHours != null) {
    params.remainingHours = String(state.remainingHours);
  }
  if (state.remainingDays != null) {
    params.remainingDays = String(state.remainingDays);
  }
  return params;
}

export type ClaimBlockReasonKey =
  | "notInPool"
  | "selfReleased"
  | "statusUnavailable"
  | "cooldown"
  | "quotaExceeded";

export type ClaimEligibility = {
  canClaim: boolean;
  claimBlockedReasonKey: ClaimBlockReasonKey | null;
  claimBlockedReasonParams?: Record<string, string>;
};

export type PublicPoolListItemBase = {
  id: string;
  maskedName: string;
  customerType: string;
  source: string;
  salesStage: string;
  completenessScore: number;
  poolEnteredAt: string | null;
  poolReasonPreview: string | null;
  lastFollowUpAt: string | null;
  lastValidFollowUpAt: string | null;
  canClaim: boolean;
  claimBlockedReasonKey: ClaimBlockReasonKey | null;
  claimBlockedReasonParams?: Record<string, string>;
};

export type StaffPublicPoolCustomerView = PublicPoolListItemBase & {
  accessLevel: "masked";
  isMasked: true;
};

export type AdminPublicPoolCustomerView = PublicPoolListItemBase & {
  customerName: string;
  poolReason: string | null;
  accessLevel: "full";
  isMasked: false;
  phone?: string | null;
  wechatId?: string | null;
  email?: string | null;
  notes?: string | null;
  sourceRemark?: string | null;
};

export type PublicPoolCustomerView =
  | StaffPublicPoolCustomerView
  | AdminPublicPoolCustomerView;

export function isAdminPublicPoolCustomerView(
  view: PublicPoolCustomerView,
): view is AdminPublicPoolCustomerView {
  return view.accessLevel === "full";
}

export function displayPublicPoolReason(
  view: PublicPoolCustomerView,
): string | null {
  if (isAdminPublicPoolCustomerView(view)) {
    return view.poolReason ?? view.poolReasonPreview;
  }
  return view.poolReasonPreview;
}

function getReleasedById(customer: Customer): string | null {
  return customer.releasedBy ?? customer.releaserUserId ?? null;
}

export function evaluateCustomerClaimEligibility(
  user: User,
  customer: Customer,
  staffStatus: StaffClaimStatus | null,
  now: Date = new Date(),
): ClaimEligibility {
  if (customer.status !== "public_pool") {
    return {
      canClaim: false,
      claimBlockedReasonKey: "notInPool",
    };
  }

  if (user.role === "admin") {
    return { canClaim: true, claimBlockedReasonKey: null };
  }

  const selfReleaseBlock = getSelfReleaseClaimBlockState(customer, user.id, now);
  if (selfReleaseBlock?.blocked) {
    return {
      canClaim: false,
      claimBlockedReasonKey: "selfReleased",
      claimBlockedReasonParams: selfReleaseBlockParams(selfReleaseBlock),
    };
  }

  if (!staffStatus) {
    return { canClaim: false, claimBlockedReasonKey: "statusUnavailable" };
  }

  if (staffStatus.inCooldown) {
    return {
      canClaim: false,
      claimBlockedReasonKey: "cooldown",
      claimBlockedReasonParams: staffStatus.blockedReasonParams,
    };
  }

  if (staffStatus.remainingQuota <= 0) {
    return {
      canClaim: false,
      claimBlockedReasonKey: "quotaExceeded",
      claimBlockedReasonParams: staffStatus.blockedReasonParams,
    };
  }

  return { canClaim: true, claimBlockedReasonKey: null };
}

function buildPublicPoolListItemBase(
  customer: Customer,
  claim: ClaimEligibility,
  hasFollowUp: boolean,
): PublicPoolListItemBase {
  const { completenessScore } = calculateDataCompletenessScore(
    customer,
    hasFollowUp,
  );

  return {
    id: customer.id,
    maskedName: maskPublicPoolCustomerName(customer.customerName),
    customerType: customer.customerType,
    source: customer.source,
    salesStage: customer.salesStage,
    completenessScore,
    poolEnteredAt: customer.poolEnteredAt ?? null,
    poolReasonPreview: truncatePoolReason(customer.poolReason),
    lastFollowUpAt: customer.lastFollowUpAt ?? null,
    lastValidFollowUpAt: customer.lastValidFollowUpAt ?? null,
    canClaim: claim.canClaim,
    claimBlockedReasonKey: claim.claimBlockedReasonKey,
    claimBlockedReasonParams: claim.claimBlockedReasonParams,
  };
}

export function formatStaffPublicPoolCustomer(
  customer: Customer,
  claim: ClaimEligibility,
  hasFollowUp: boolean,
): StaffPublicPoolCustomerView {
  return {
    ...buildPublicPoolListItemBase(customer, claim, hasFollowUp),
    accessLevel: "masked",
    isMasked: true,
  };
}

export function formatAdminPublicPoolCustomer(
  user: User,
  customer: Customer,
  claim: ClaimEligibility,
  hasFollowUp: boolean,
): AdminPublicPoolCustomerView {
  const base = formatCustomerForUser(user, customer);
  const shared = buildPublicPoolListItemBase(customer, claim, hasFollowUp);

  return {
    ...shared,
    customerName: customer.customerName,
    poolReason: customer.poolReason ?? null,
    accessLevel: "full",
    isMasked: false,
    phone: base.phone,
    wechatId: base.wechatId,
    email: base.email,
    notes: base.notes,
    sourceRemark: base.sourceRemark,
  };
}

export function formatPublicPoolCustomer(
  user: User,
  customer: Customer,
  claim: ClaimEligibility,
  hasFollowUp: boolean,
): PublicPoolCustomerView {
  if (user.role === "admin") {
    return formatAdminPublicPoolCustomer(user, customer, claim, hasFollowUp);
  }

  return formatStaffPublicPoolCustomer(customer, claim, hasFollowUp);
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

  const followUpSet = await getCustomerIdsWithFollowUps(
    getDb(),
    customers.map((customer) => customer.id),
  );

  return customers.map((customer) => {
    const claim = evaluateCustomerClaimEligibility(
      user,
      customer,
      staffStatus,
    );
    return formatPublicPoolCustomer(
      user,
      customer,
      claim,
      followUpSet.has(customer.id),
    );
  });
}

export function claimBlockReasonToErrorCode(
  key: ClaimBlockReasonKey | null,
): string | undefined {
  switch (key) {
    case "notInPool":
      return "PUBLIC_POOL_CLIENT_NOT_FOUND";
    case "selfReleased":
      return "CLAIM_SELF_RELEASED";
    case "cooldown":
      return "CLAIM_COOLDOWN";
    case "quotaExceeded":
      return "CLAIM_QUOTA_EXCEEDED";
    case "statusUnavailable":
      return "CLAIM_STATUS_UNAVAILABLE";
    default:
      return undefined;
  }
}
