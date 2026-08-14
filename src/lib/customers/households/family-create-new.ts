import type { Customer } from "../../../../drizzle/schema/customers";
import type { User } from "../../../../drizzle/schema/users";
import type { Database } from "@/lib/db";
import {
  prepareCustomerCreation,
  type CustomerCreateAuditContext,
  type CustomerCreatePreparedMeta,
} from "@/lib/customers/create-customer-service";
import { FAMILY_ERROR_CODES, FamilyLinkError } from "./errors";
import { assertCanManageCustomerFamily } from "./family-permissions";
import {
  buildFamilyLinkStatements,
  loadCustomerById,
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
    };

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
  testAppendStatements?: unknown[];
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
  });

  if (prepared.kind === "validation") {
    return { kind: "validation", fieldErrors: prepared.fieldErrors };
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

  const batchStatements = [
    ...prepared.statements,
    ...familyStatements,
    ...(input.testAppendStatements ?? []),
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
  await writeFamilyLinkAudit(input.db, {
    source: input.source,
    target,
    relationshipType,
    householdId,
    householdAction: mapPlanToHouseholdAction(plan),
    actor: input.actor,
  });

  if (prepared.meta.pendingOnHoldApproval) {
    const { createApprovalRequest } = await import("@/lib/approvals/service");
    const { buildOnHoldCreateApprovalPayload } = await import(
      "@/lib/customers/on-hold-create-pending"
    );
    const { writeAuditLog } = await import("@/lib/audit/audit-log");
    const customer = await loadCustomerById(input.db, targetId);
    if (!customer) {
      throw new Error("CUSTOMER_CREATE_MISSING_AFTER_BATCH");
    }

    const { id: approvalId } = await createApprovalRequest(
      customer,
      input.actor,
      {
        requestType: "create_on_hold_customer",
        reason: prepared.meta.validatedOnHoldReason!,
        payload: buildOnHoldCreateApprovalPayload({
          requestedSalesStage: prepared.meta.requestedSalesStage,
          onHoldReason: prepared.meta.validatedOnHoldReason!,
          customerName: prepared.meta.createInput.customerName!,
          customerType: prepared.meta.createInput.customerType!,
          phoneCountryCode: prepared.meta.createInput.phoneCountryCode!,
          phone: prepared.meta.createInput.phone,
          wechatId: prepared.meta.createInput.wechatId,
          email: prepared.meta.createInput.email,
          source: prepared.meta.createInput.source!,
          sourceRemark: prepared.meta.createInput.sourceRemark,
          requestedProjectCode: prepared.meta.payload.requestedProjectCode,
          requestedProjectName: prepared.meta.payload.requestedProjectName,
          notes: prepared.meta.createInput.notes,
        }),
      },
      {
        ipAddress: input.audit?.ipAddress ?? undefined,
        userAgent: input.audit?.userAgent ?? undefined,
      },
    );

    await writeAuditLog(
      {
        userId: input.actor.id,
        action: "customer.created",
        entityType: "customer",
        entityId: targetId,
        ipAddress: input.audit?.ipAddress ?? undefined,
        userAgent: input.audit?.userAgent ?? undefined,
        metadata: {
          customerName: prepared.meta.createInput.customerName,
          customerCode: prepared.meta.customerCode,
          source: prepared.meta.createInput.source,
          ownerId: prepared.meta.ownerId,
          nameStatus: prepared.meta.nameStatus,
          familySourceCustomerId: input.source.id,
          ...(prepared.meta.duplicateNameWarningConfirmed
            ? { duplicateNameWarningConfirmed: true }
            : {}),
        },
      },
      input.db,
    );

    await writeAuditLog(
      {
        userId: input.actor.id,
        action: "customer.create_on_hold.pending",
        entityType: "customer",
        entityId: targetId,
        ipAddress: input.audit?.ipAddress ?? undefined,
        userAgent: input.audit?.userAgent ?? undefined,
        metadata: {
          customerName: prepared.meta.createInput.customerName,
          customerCode: prepared.meta.customerCode,
          approvalId,
          requestedSalesStage: prepared.meta.requestedSalesStage,
          nameStatus: prepared.meta.nameStatus,
          ...(prepared.meta.duplicateNameWarningConfirmed
            ? { duplicateNameWarningConfirmed: true }
            : {}),
        },
      },
      input.db,
    );

    return {
      ok: true,
      id: targetId,
      familyLinked: true,
      pendingApproval: true,
      approvalId,
      message: "ON_HOLD_APPROVAL_REQUIRED",
    };
  }

  const { writeAuditLog } = await import("@/lib/audit/audit-log");
  await writeAuditLog(
    {
      userId: input.actor.id,
      action: "customer.created",
      entityType: "customer",
      entityId: targetId,
      ipAddress: input.audit?.ipAddress ?? undefined,
      userAgent: input.audit?.userAgent ?? undefined,
      metadata: {
        customerName: prepared.meta.createInput.customerName,
        customerCode: prepared.meta.customerCode,
        source: prepared.meta.createInput.source,
        ownerId: prepared.meta.ownerId,
        nameStatus: prepared.meta.nameStatus,
        familySourceCustomerId: input.source.id,
        ...(prepared.meta.duplicateNameWarningConfirmed
          ? { duplicateNameWarningConfirmed: true }
          : {}),
      },
    },
    input.db,
  );

  return { ok: true, id: targetId, familyLinked: true };
}
