import type { User } from "../../../drizzle/schema/users";
import { eq } from "drizzle-orm";
import { writeAuditLog } from "@/lib/audit/audit-log";
import { getDb, schema, type Database } from "@/lib/db";
import { parseCustomerBody } from "@/lib/customers/parse-input";
import { validateCustomerInput } from "@/lib/customers/validation";
import { checkCustomerDuplicates } from "@/lib/customers/duplicate-check";
import {
  checkCustomerNameDuplicates,
  duplicateCustomerNameConflictResponse,
} from "@/lib/customers/name-duplicate-check";
import {
  normalizeCustomerNameForDuplicateMatch,
  parseConfirmDuplicateName,
} from "@/lib/customers/name-duplicate";
import { buildReplaceCustomerIdentifierStatements } from "@/lib/customers/contact-identifiers";
import {
  duplicateCustomerConflictResponse,
  resolveIdentifierConstraintAsDuplicates,
} from "@/lib/customers/contact-identifier-conflict";
import { buildCustomerUpdatePayload } from "@/lib/customers/field-change-log";
import { allocateCustomerCode } from "@/lib/customers/customer-code";
import { buildInsertPrimaryAssigneeStatement } from "@/lib/customers/primary-assignee";
import {
  buildOnHoldCreateApprovalPayload,
  isStaffOnHoldCreatePending,
  resolvePersistedSalesStageForCreate,
  validateOnHoldReason,
} from "@/lib/customers/on-hold-create-pending";
import { resolveRequestedProjectForPersist } from "@/lib/customers/requested-project-resolve";
import { getCustomerById } from "@/lib/customers/queries";
import { buildOnHoldCreatePriorityFields } from "@/lib/customers/priority-customer";
import {
  createApprovalRequest,
  ApprovalError,
} from "@/lib/approvals/service";
import type { ValidationFieldError } from "@/lib/customers/validation";
import type { CustomerType } from "@/lib/constants/customer-fields";

export type ParsedCustomerCreateInput = ReturnType<typeof parseCustomerBody>;

export type CustomerCreatePreparedMeta = {
  id: string;
  customerCode: string;
  ownerId: string;
  nameStatus: "confirmed" | "pending";
  createInput: ParsedCustomerCreateInput & { status: "active" };
  requestedSalesStage: string;
  persistedSalesStage: string;
  pendingOnHoldApproval: boolean;
  validatedOnHoldReason?: string;
  duplicateNameWarningConfirmed: boolean;
  payload: ReturnType<typeof buildCustomerUpdatePayload>;
  now: string;
};

export type PrepareCustomerCreationResult =
  | {
      kind: "validation";
      fieldErrors: ValidationFieldError[];
      auditMetadata?: Record<string, unknown>;
    }
  | { kind: "internal_error" }
  | { kind: "duplicate"; duplicates: Awaited<ReturnType<typeof checkCustomerDuplicates>> }
  | {
      kind: "name_duplicate";
      response: Response;
    }
  | {
      kind: "ready";
      statements: unknown[];
      meta: CustomerCreatePreparedMeta;
    };

export type ExecuteCustomerCreationSuccess = {
  kind: "created";
  id: string;
};

export type ExecuteCustomerCreationPendingApproval = {
  kind: "pending_approval";
  id: string;
  approvalId: string;
};

export type ExecuteCustomerCreationResult =
  | ExecuteCustomerCreationSuccess
  | ExecuteCustomerCreationPendingApproval;

export type CustomerCreateAuditContext = {
  ipAddress?: string | null;
  userAgent?: string | null;
};

function resolveOwnerId(
  user: User,
  body: Record<string, unknown>,
): string {
  return user.role === "admin"
    ? (typeof body.ownerId === "string" ? body.ownerId : user.id)
    : user.id;
}

async function loadCreatedCustomer(db: Database | undefined, id: string) {
  if (db) {
    const rows = await db
      .select()
      .from(schema.customers)
      .where(eq(schema.customers.id, id))
      .limit(1);
    return rows[0] ?? null;
  }
  return getCustomerById(id);
}

export async function prepareCustomerCreation(input: {
  actor: User;
  body: Record<string, unknown>;
  allowedSourceKeys: string[];
  db?: Database;
  preallocatedId?: string;
  forceCustomerType?: CustomerType;
}): Promise<PrepareCustomerCreationResult> {
  const db = input.db ?? getDb();
  const parsed = parseCustomerBody(input.body, { forCreate: true });
  const createInput = {
    ...parsed,
    status: "active" as const,
    ...(input.forceCustomerType
      ? { customerType: input.forceCustomerType }
      : {}),
  };

  const fieldErrors = validateCustomerInput(createInput, {
    requireSalesStage: true,
    allowedSourceKeys: input.allowedSourceKeys,
    userRole: input.actor.role === "admin" ? "admin" : "staff",
    enforceCreateNameStatusRules: true,
  });
  if (fieldErrors.length > 0) {
    return {
      kind: "validation",
      fieldErrors,
      auditMetadata: { fieldErrors },
    };
  }

  if (
    input.forceCustomerType &&
    createInput.customerType !== input.forceCustomerType
  ) {
    return {
      kind: "validation",
      fieldErrors: [
        {
          field: "customerType",
          code: "INVALID_CUSTOMER_TYPE",
          message: "家庭成员必须是个人客户",
        },
      ],
    };
  }

  const ownerId = resolveOwnerId(input.actor, input.body);

  const duplicates = await checkCustomerDuplicates(
    {
      phoneCountryCode: createInput.phoneCountryCode,
      phone: createInput.phone,
      wechatId: createInput.wechatId,
      email: createInput.email,
    },
    input.actor,
  );
  if (duplicates.length > 0) {
    return { kind: "duplicate", duplicates };
  }

  const nameStatus =
    createInput.nameStatus === "pending" ? "pending" : "confirmed";
  let duplicateNameWarningConfirmed = false;

  if (nameStatus === "confirmed") {
    const normalizedName = normalizeCustomerNameForDuplicateMatch(
      createInput.customerName,
    );
    if (normalizedName) {
      let nameDuplicates;
      try {
        nameDuplicates = await checkCustomerNameDuplicates(
          normalizedName,
          input.actor,
        );
      } catch {
        return { kind: "internal_error" };
      }
      if (nameDuplicates.length > 0) {
        const confirm = parseConfirmDuplicateName(input.body.confirmDuplicateName);
        if (confirm !== normalizedName) {
          return {
            kind: "name_duplicate",
            response: duplicateCustomerNameConflictResponse({
              normalizedName,
              duplicates: nameDuplicates,
            }),
          };
        }
        duplicateNameWarningConfirmed = true;
      }
    }
  }

  const now = new Date().toISOString();
  const id = input.preallocatedId ?? crypto.randomUUID();
  const customerCode = await allocateCustomerCode(db);
  const requestedSalesStage = createInput.salesStage!;
  const pendingOnHoldApproval = isStaffOnHoldCreatePending(
    input.actor.role,
    requestedSalesStage,
  );

  let validatedOnHoldReason: string | undefined;
  if (pendingOnHoldApproval) {
    const reasonValidation = validateOnHoldReason(input.body.onHoldReason);
    if (!reasonValidation.ok) {
      return {
        kind: "validation",
        fieldErrors: [
          {
            field: "onHoldReason",
            code: reasonValidation.errorCode,
            message:
              reasonValidation.errorCode === "ON_HOLD_REASON_REQUIRED"
                ? "请填写搁置申请理由"
                : "搁置申请理由至少需要 8 个字",
          },
        ],
        auditMetadata: {
          errorCode: reasonValidation.errorCode,
          field: "onHoldReason",
        },
      };
    }
    validatedOnHoldReason = reasonValidation.value;
  }

  const persistedSalesStage = resolvePersistedSalesStageForCreate(
    input.actor.role,
    requestedSalesStage,
  );

  const projectResolved = resolveRequestedProjectForPersist({
    requestedProjectCode: createInput.requestedProjectCode,
    requestedProjectName: createInput.requestedProjectName,
    mode: "create",
  });
  if (!projectResolved.ok) {
    return {
      kind: "validation",
      fieldErrors: projectResolved.fieldErrors,
    };
  }

  const payload = buildCustomerUpdatePayload({
    customerName: createInput.customerName!,
    customerType: createInput.customerType!,
    phoneCountryCode: createInput.phoneCountryCode!,
    phone: createInput.phone ?? null,
    wechatId: createInput.wechatId ?? null,
    email: createInput.email ?? null,
    source: createInput.source!,
    sourceRemark: createInput.sourceRemark ?? null,
    requestedProjectCode: projectResolved.value.requestedProjectCode,
    requestedProjectName: projectResolved.value.requestedProjectName,
    notes: createInput.notes ?? null,
    salesStage: persistedSalesStage,
    status: "active",
    preferredName: createInput.preferredName,
    gender: createInput.gender,
    ageRange: createInput.ageRange,
    preferredLanguage: createInput.preferredLanguage,
    preferredContactMethod: createInput.preferredContactMethod,
    occupation: createInput.occupation,
    companyName: createInput.companyName,
    jobTitle: createInput.jobTitle,
    targetCountryOrRegion: createInput.targetCountryOrRegion,
    primaryConcern: createInput.primaryConcern,
  });

  const insertCustomerStmt = db.insert(schema.customers).values({
    id,
    customerCode,
    customerName: payload.customerName,
    nameStatus,
    customerType: payload.customerType,
    phoneCountryCode: payload.phoneCountryCode,
    phone: payload.phone,
    wechatId: payload.wechatId,
    email: payload.email,
    source: payload.source,
    sourceRemark: payload.sourceRemark,
    requestedProjectCode: payload.requestedProjectCode,
    requestedProjectName: payload.requestedProjectName,
    notes: payload.notes,
    preferredName: payload.preferredName,
    gender: payload.gender,
    ageRange: payload.ageRange,
    preferredLanguage: payload.preferredLanguage,
    preferredContactMethod: payload.preferredContactMethod,
    occupation: payload.occupation,
    companyName: payload.companyName,
    jobTitle: payload.jobTitle,
    targetCountryOrRegion: payload.targetCountryOrRegion,
    primaryConcern: payload.primaryConcern,
    salesStage: payload.salesStage,
    status: payload.status,
    ...(payload.salesStage === "on_hold" && !pendingOnHoldApproval
      ? buildOnHoldCreatePriorityFields(now)
      : {}),
    ownerId,
    createdBy: input.actor.id,
    updatedBy: input.actor.id,
    reclamationCycleStartedAt: now,
    createdAt: now,
    updatedAt: now,
  });

  const insertPrimaryAssigneeStmt = buildInsertPrimaryAssigneeStatement(db, {
    customerId: id,
    ownerId,
    assignedBy: input.actor.id,
    now,
  });

  const identifierSync = buildReplaceCustomerIdentifierStatements(db, {
    customerId: id,
    phoneCountryCode: payload.phoneCountryCode,
    phone: payload.phone,
    wechatId: payload.wechatId,
    email: payload.email,
    secondaryContacts: [],
    now,
  });

  return {
    kind: "ready",
    statements: [
      insertCustomerStmt,
      insertPrimaryAssigneeStmt,
      ...identifierSync.statements,
    ],
    meta: {
      id,
      customerCode,
      ownerId,
      nameStatus,
      createInput,
      requestedSalesStage,
      persistedSalesStage,
      pendingOnHoldApproval,
      validatedOnHoldReason,
      duplicateNameWarningConfirmed,
      payload,
      now,
    },
  };
}

export async function finalizePreparedCustomerCreation(input: {
  db?: Database;
  actor: User;
  meta: CustomerCreatePreparedMeta;
  audit?: CustomerCreateAuditContext;
  createdMetadata?: Record<string, unknown>;
  /** B5 writes customer.created before on-hold pending audit; normal create does not. */
  auditCreatedOnOnHold?: boolean;
}): Promise<ExecuteCustomerCreationResult> {
  const {
    db,
    actor,
    meta,
    audit,
    createdMetadata,
    auditCreatedOnOnHold = false,
  } = input;
  const writeLog = db
    ? (entry: Parameters<typeof writeAuditLog>[0]) => writeAuditLog(entry, db)
    : writeAuditLog;

  if (meta.pendingOnHoldApproval) {
    const customer = await loadCreatedCustomer(db, meta.id);
    if (!customer) {
      throw new Error("CUSTOMER_CREATE_MISSING_AFTER_BATCH");
    }

    const { id: approvalId } = await createApprovalRequest(
      customer,
      actor,
      {
        requestType: "create_on_hold_customer",
        reason: meta.validatedOnHoldReason!,
        payload: buildOnHoldCreateApprovalPayload({
          requestedSalesStage: meta.requestedSalesStage,
          onHoldReason: meta.validatedOnHoldReason!,
          customerName: meta.createInput.customerName!,
          customerType: meta.createInput.customerType!,
          phoneCountryCode: meta.createInput.phoneCountryCode!,
          phone: meta.createInput.phone,
          wechatId: meta.createInput.wechatId,
          email: meta.createInput.email,
          source: meta.createInput.source!,
          sourceRemark: meta.createInput.sourceRemark,
          requestedProjectCode: meta.payload.requestedProjectCode,
          requestedProjectName: meta.payload.requestedProjectName,
          notes: meta.createInput.notes,
        }),
      },
      {
        ipAddress: audit?.ipAddress ?? undefined,
        userAgent: audit?.userAgent ?? undefined,
      },
    );

    if (auditCreatedOnOnHold) {
      await writeLog({
        userId: actor.id,
        action: "customer.created",
        entityType: "customer",
        entityId: meta.id,
        ipAddress: audit?.ipAddress ?? undefined,
        userAgent: audit?.userAgent ?? undefined,
        metadata: {
          customerName: meta.createInput.customerName,
          customerCode: meta.customerCode,
          source: meta.createInput.source,
          ownerId: meta.ownerId,
          nameStatus: meta.nameStatus,
          ...(createdMetadata ?? {}),
          ...(meta.duplicateNameWarningConfirmed
            ? { duplicateNameWarningConfirmed: true }
            : {}),
        },
      });
    }

    await writeLog({
      userId: actor.id,
      action: "customer.create_on_hold.pending",
      entityType: "customer",
      entityId: meta.id,
      ipAddress: audit?.ipAddress ?? undefined,
      userAgent: audit?.userAgent ?? undefined,
      metadata: {
        customerName: meta.createInput.customerName,
        customerCode: meta.customerCode,
        approvalId,
        requestedSalesStage: meta.requestedSalesStage,
        nameStatus: meta.nameStatus,
        ...(meta.duplicateNameWarningConfirmed
          ? { duplicateNameWarningConfirmed: true }
          : {}),
      },
    });

    return { kind: "pending_approval", id: meta.id, approvalId };
  }

  await writeLog({
    userId: actor.id,
    action: "customer.created",
    entityType: "customer",
    entityId: meta.id,
    ipAddress: audit?.ipAddress ?? undefined,
    userAgent: audit?.userAgent ?? undefined,
    metadata: {
      customerName: meta.createInput.customerName,
      customerCode: meta.customerCode,
      source: meta.createInput.source,
      ownerId: meta.ownerId,
      nameStatus: meta.nameStatus,
      ...(createdMetadata ?? {}),
      ...(meta.duplicateNameWarningConfirmed
        ? { duplicateNameWarningConfirmed: true }
        : {}),
    },
  });

  return { kind: "created", id: meta.id };
}

export async function executePreparedCustomerCreation(input: {
  db: Database;
  actor: User;
  statements: unknown[];
  meta: CustomerCreatePreparedMeta;
  audit?: CustomerCreateAuditContext;
}): Promise<ExecuteCustomerCreationResult> {
  const { db, actor, statements, meta, audit } = input;

  try {
    await db.batch(
      statements as unknown as Parameters<Database["batch"]>[0],
    );
  } catch (batchError) {
    const mapped = await resolveIdentifierConstraintAsDuplicates(
      batchError,
      {
        phoneCountryCode: meta.payload.phoneCountryCode,
        phone: meta.payload.phone,
        wechatId: meta.payload.wechatId,
        email: meta.payload.email,
      },
      actor,
    );
    if (mapped) {
      throw duplicateCustomerConflictResponse(mapped.duplicates);
    }
    throw batchError;
  }

  return finalizePreparedCustomerCreation({
    db,
    actor,
    meta,
    audit,
  });
}

export { ApprovalError, duplicateCustomerConflictResponse };
