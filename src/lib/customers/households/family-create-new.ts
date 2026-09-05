import type { Customer } from "../../../../drizzle/schema/customers";
import type { User } from "../../../../drizzle/schema/users";
import type { Database } from "@/lib/db";
import {
  finalizePreparedCustomerCreation,
  prepareCustomerCreation,
  type CustomerCreateAuditContext,
  type CustomerCreatePreparedMeta,
} from "@/lib/customers/create-customer-service";
import { FAMILY_ERROR_CODES, FamilyLinkError } from "./errors";
import { assertCanManageCustomerFamily } from "./family-permissions";
import {
  buildFamilyLinkStatements,
  writeFamilyLinkAudit,
} from "./link-existing";
import {
  isValidHouseholdRelationshipType,
  mapPlanToHouseholdAction,
  planFamilyLink,
} from "./link-plan";
import { mapBatchUniqueConstraintError } from "./family-create-batch-errors";
import { resolveIdentifierConstraintAsDuplicates } from "@/lib/customers/contact-identifier-conflict";

export type FamilyCreateNewBody = Record<string, unknown> & {
  relationshipType?: string;
};

export type FamilyCreateNewResult =
  | { ok: true; id: string; familyLinked: true; pendingApproval?: false }
  | {
      ok: true;
      id: string;
      familyLinked: true;
      pendingApproval: true;
      approvalId: string;
      message: "ON_HOLD_APPROVAL_REQUIRED";
    };

export type FamilyCreateNewOutcome =
  | FamilyCreateNewResult
  | {
      kind: "validation";
      fieldErrors: import("@/lib/customers/validation").ValidationFieldError[];
    }
  | {
      kind: "duplicate";
      duplicates: Awaited<
        ReturnType<typeof import("@/lib/customers/duplicate-check").checkCustomerDuplicates>
      >;
    }
  | {
      kind: "name_duplicate";
      normalizedName: string;
      duplicates: unknown[];
    }
  | { kind: "internal_error" };

function mapPlanError(plan: Awaited<ReturnType<typeof planFamilyLink>>): FamilyLinkError | null {
  switch (plan.kind) {
    case "household_conflict":
      return new FamilyLinkError(
        409,
        "该客户已属于另一个家庭组，目前不能直接关联",
        FAMILY_ERROR_CODES.HOUSEHOLD_CONFLICT,
      );
    case "relationship_conflict":
      return new FamilyLinkError(
        409,
        "两位客户已存在不同的家庭关系记录",
        FAMILY_ERROR_CODES.RELATIONSHIP_CONFLICT,
      );
    case "invalid_household_state":
      return new FamilyLinkError(
        409,
        "家庭组状态异常，请联系管理员处理",
        FAMILY_ERROR_CODES.INVALID_HOUSEHOLD_STATE,
      );
    default:
      return null;
  }
}

function assertIndividualCustomerType(body: Record<string, unknown>): void {
  const rawType = body.customerType;
  if (rawType != null && rawType !== "individual") {
    throw new FamilyLinkError(
      400,
      "家庭成员必须是个人客户",
      FAMILY_ERROR_CODES.TARGET_NOT_ELIGIBLE,
    );
  }
}

function buildTargetCustomerForAudit(
  meta: CustomerCreatePreparedMeta,
): Customer {
  return {
    id: meta.id,
    customerCode: meta.customerCode,
    customerName: meta.payload.customerName,
    nameStatus: meta.nameStatus,
    customerType: "individual",
    phoneCountryCode: meta.payload.phoneCountryCode,
    phone: meta.payload.phone,
    wechatId: meta.payload.wechatId,
    email: meta.payload.email,
    source: meta.payload.source,
    sourceRemark: meta.payload.sourceRemark,
    requestedProjectCode: meta.payload.requestedProjectCode,
    requestedProjectName: meta.payload.requestedProjectName,
    notes: meta.payload.notes,
    preferredName: meta.payload.preferredName,
    gender: meta.payload.gender,
    ageRange: meta.payload.ageRange,
    preferredLanguage: meta.payload.preferredLanguage,
    preferredContactMethod: meta.payload.preferredContactMethod,
    occupation: meta.payload.occupation,
    companyName: meta.payload.companyName,
    jobTitle: meta.payload.jobTitle,
    targetCountryOrRegion: meta.payload.targetCountryOrRegion,
    primaryConcern: meta.payload.primaryConcern,
    salesStage: meta.payload.salesStage,
    ownerId: meta.ownerId,
    status: "active",
    createdBy: meta.ownerId,
    updatedBy: meta.ownerId,
    createdAt: meta.now,
    updatedAt: meta.now,
    deletedAt: null,
    releaserUserId: null,
    poolEnteredAt: null,
    poolReason: null,
    releasedBy: null,
    previousOwnerId: null,
    claimedBy: null,
    claimedAt: null,
    poolLeftAt: null,
    lastFollowUpAt: null,
    lastValidFollowUpAt: null,
    nextFollowUpAt: null,
    reclamationCycleStartedAt: meta.now,
    reclaimRuleGraceUntil: null,
    deletedBy: null,
    deletedReason: null,
    isPinned: 0,
    pinnedAt: null,
    collaborativeDissolvedAt: null,
    lifecycleStatus: null,
    lifecycleCompletedAt: null,
    lifecycleCompletedBy: null,
    lifecycleCompletionNotes: null,
  } as Customer;
}

export async function createFamilyMemberCustomer(input: {
  db: Database;
  source: Customer;
  actor: User;
  body: FamilyCreateNewBody;
  allowedSourceKeys: string[];
  audit?: CustomerCreateAuditContext;
  testAppendStatements?:
    | unknown[]
    | ((ctx: { db: Database; targetId: string }) => unknown[]);
}): Promise<FamilyCreateNewOutcome> {
  assertCanManageCustomerFamily(input.actor, input.source);
  assertIndividualCustomerType(input.body);

  const relationshipType = input.body.relationshipType;
  if (
    !relationshipType ||
    !isValidHouseholdRelationshipType(relationshipType)
  ) {
    throw new FamilyLinkError(
      400,
      "请选择家庭关系",
      FAMILY_ERROR_CODES.INVALID_RELATIONSHIP,
    );
  }

  const targetId = crypto.randomUUID();
  const prepared = await prepareCustomerCreation({
    actor: input.actor,
    body: input.body,
    allowedSourceKeys: input.allowedSourceKeys,
    db: input.db,
    preallocatedId: targetId,
    forceCustomerType: "individual",
    includeCollaborators: false,
  });

  if (prepared.kind === "validation") {
    return { kind: "validation", fieldErrors: prepared.fieldErrors };
  }
  if (prepared.kind === "internal_error") {
    return { kind: "internal_error" };
  }
  if (prepared.kind === "duplicate") {
    return { kind: "duplicate", duplicates: prepared.duplicates };
  }
  if (prepared.kind === "name_duplicate") {
    const responseBody = await prepared.response.clone().json() as {
      normalizedName?: string;
      duplicates?: unknown[];
    };
    return {
      kind: "name_duplicate",
      normalizedName: responseBody.normalizedName ?? "",
      duplicates: responseBody.duplicates ?? [],
    };
  }

  const plan = await planFamilyLink(
    input.db,
    input.source.id,
    targetId,
    relationshipType,
  );
  const planError = mapPlanError(plan);
  if (planError) {
    throw planError;
  }
  if (plan.kind === "already_linked") {
    throw new FamilyLinkError(
      409,
      "该客户已是家庭成员",
      FAMILY_ERROR_CODES.LINK_ALREADY_EXISTS,
    );
  }

  const { statements: familyStatements, householdId } = buildFamilyLinkStatements(
    input.db,
    {
      plan,
      sourceId: input.source.id,
      targetId,
      relationshipType,
      actorId: input.actor.id,
      now: prepared.meta.now,
    },
  );

  const appendStatements =
    typeof input.testAppendStatements === "function"
      ? input.testAppendStatements({ db: input.db, targetId })
      : (input.testAppendStatements ?? []);

  const batchStatements = [
    ...prepared.statements,
    ...familyStatements,
    ...appendStatements,
  ];

  try {
    await input.db.batch(
      batchStatements as unknown as Parameters<Database["batch"]>[0],
    );
  } catch (error) {
    const mapped = await resolveIdentifierConstraintAsDuplicates(
      error,
      {
        phoneCountryCode: prepared.meta.payload.phoneCountryCode,
        phone: prepared.meta.payload.phone,
        wechatId: prepared.meta.payload.wechatId,
        email: prepared.meta.payload.email,
      },
      input.actor,
    );
    if (mapped) {
      return { kind: "duplicate", duplicates: mapped.duplicates };
    }
    const uniqueError = mapBatchUniqueConstraintError(error);
    if (uniqueError) {
      throw uniqueError;
    }
    throw error;
  }

  const target = buildTargetCustomerForAudit(prepared.meta);
  const finalizeResult = await finalizePreparedCustomerCreation({
    db: input.db,
    actor: input.actor,
    meta: prepared.meta,
    audit: input.audit,
    createdMetadata: { familySourceCustomerId: input.source.id },
    auditCreatedOnOnHold: true,
  });

  await writeFamilyLinkAudit(input.db, {
    source: input.source,
    target,
    relationshipType,
    householdId,
    householdAction: mapPlanToHouseholdAction(plan),
    actor: input.actor,
  });

  if (finalizeResult.kind === "pending_approval") {
    return {
      ok: true,
      id: finalizeResult.id,
      familyLinked: true,
      pendingApproval: true,
      approvalId: finalizeResult.approvalId,
      message: "ON_HOLD_APPROVAL_REQUIRED",
    };
  }

  return { ok: true, id: finalizeResult.id, familyLinked: true };
}
