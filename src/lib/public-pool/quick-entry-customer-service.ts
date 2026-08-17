import type { Database } from "@/lib/db";
import { getDb, schema } from "@/lib/db";
import { allocateCustomerCode } from "@/lib/customers/customer-code";
import { checkCustomerDuplicates } from "@/lib/customers/duplicate-check";
import {
  buildReplaceCustomerIdentifierStatements,
  isGlobalContactIdentifierUniqueConstraintError,
} from "@/lib/customers/contact-identifiers";
import { userMustChangePassword } from "@/lib/auth/change-password";
import { getSelectableCustomerSourceKeys } from "@/lib/customer-sources/keys";
import { QUICK_ENTRY_ENTRY_METHOD } from "@/lib/public-pool/quick-entry-entry-method";
import {
  validateQuickEntryCustomerInput,
  type QuickEntryCustomerInput,
  type QuickEntryCustomerNormalized,
  type QuickEntryValidationError,
} from "@/lib/public-pool/quick-entry-customer-validation";
import type { User } from "../../../drizzle/schema/users";

export const QUICK_ENTRY_CUSTOMER_AUDIT_ACTION =
  "customer.created.public_pool_direct" as const;

export const QUICK_ENTRY_SERVICE_ERROR_CODES = {
  ACTOR_INVALID: "QUICK_ENTRY_ACTOR_INVALID",
  DUPLICATE_PHONE: "QUICK_ENTRY_DUPLICATE_PHONE",
  DUPLICATE_WECHAT: "QUICK_ENTRY_DUPLICATE_WECHAT",
  DUPLICATE_EMAIL: "QUICK_ENTRY_DUPLICATE_EMAIL",
  POSSIBLE_DUPLICATE: "QUICK_ENTRY_POSSIBLE_DUPLICATE",
} as const;

export type QuickEntryCreateSuccess = {
  ok: true;
  customerId: string;
  customerCode: string;
  customerName: string;
};

export type QuickEntryCreateFailure = {
  ok: false;
  errorCode: string;
  message: string;
  field?: string;
  validationErrors?: QuickEntryValidationError[];
  /** Present on duplicate failures; never includes existing customer PII. */
  duplicate?: true;
  duplicateField?: "phone" | "wechatId" | "email";
};

export type QuickEntryCreateResult =
  | QuickEntryCreateSuccess
  | QuickEntryCreateFailure;

export type PrepareDirectPublicPoolCustomerInvalid = {
  kind: "invalid";
  errorCode: string;
  message: string;
  field?: string;
  validationErrors?: QuickEntryValidationError[];
};

export type PrepareDirectPublicPoolCustomerDuplicate = {
  kind: "duplicate";
  errorCode: string;
  message: string;
  field?: string;
  duplicateField: "phone" | "wechatId" | "email";
};

export type PrepareDirectPublicPoolCustomerReady = {
  kind: "ready";
  customerId: string;
  customerCode: string;
  customerName: string;
  statements: unknown[];
};

export type PrepareDirectPublicPoolCustomerResult =
  | PrepareDirectPublicPoolCustomerInvalid
  | PrepareDirectPublicPoolCustomerDuplicate
  | PrepareDirectPublicPoolCustomerReady;

function assertActor(actor: User): QuickEntryCreateFailure | null {
  if (
    !actor ||
    actor.isActive !== 1 ||
    actor.deletedAt != null ||
    userMustChangePassword(actor) ||
    (actor.role !== "admin" && actor.role !== "staff")
  ) {
    return {
      ok: false,
      errorCode: QUICK_ENTRY_SERVICE_ERROR_CODES.ACTOR_INVALID,
      message: "操作者无效",
    };
  }
  return null;
}

/**
 * Validates + duplicate-checks and builds Customer + Audit INSERT statements
 * without executing them. Intended for Batch Domain atomic composition.
 */
export async function prepareDirectPublicPoolCustomerCreation(input: {
  actor: User;
  customer: QuickEntryCustomerInput;
  db?: Database;
  now?: Date;
}): Promise<PrepareDirectPublicPoolCustomerResult> {
  const actorFailure = assertActor(input.actor);
  if (actorFailure) {
    return {
      kind: "invalid",
      errorCode: actorFailure.errorCode,
      message: actorFailure.message,
    };
  }

  const preValidated = validateQuickEntryCustomerInput(input.customer);
  if (!preValidated.ok) {
    return {
      kind: "invalid",
      errorCode:
        preValidated.errors[0]?.errorCode ??
        "QUICK_ENTRY_CUSTOMER_VALIDATION_FAILED",
      message: "输入校验失败",
      field: preValidated.errors[0]?.field,
      validationErrors: preValidated.errors,
    };
  }

  const database = input.db ?? getDb();
  const selectableSourceKeys = await getSelectableCustomerSourceKeys(database);
  const validated = validateQuickEntryCustomerInput(input.customer, {
    selectableSourceKeys,
  });
  if (!validated.ok) {
    return {
      kind: "invalid",
      errorCode:
        validated.errors[0]?.errorCode ??
        "QUICK_ENTRY_CUSTOMER_VALIDATION_FAILED",
      message: "输入校验失败",
      field: validated.errors[0]?.field,
      validationErrors: validated.errors,
    };
  }

  const normalized = validated.value;
  const actor = input.actor;

  const firstDup = await findSafeDuplicate(normalized, actor);
  if (firstDup) {
    return {
      kind: "duplicate",
      errorCode: firstDup.errorCode,
      message: firstDup.message,
      field: firstDup.field,
      duplicateField: firstDup.duplicateField ?? "phone",
    };
  }

  const customerCode = await allocateCustomerCode(database);

  const secondDup = await findSafeDuplicate(normalized, actor);
  if (secondDup) {
    return {
      kind: "duplicate",
      errorCode: secondDup.errorCode,
      message: secondDup.message,
      field: secondDup.field,
      duplicateField: secondDup.duplicateField ?? "phone",
    };
  }

  const now = (input.now ?? new Date()).toISOString();
  const customerId = crypto.randomUUID();

  const insertCustomer = database.insert(schema.customers).values({
    id: customerId,
    customerCode,
    customerName: normalized.customerName,
    nameStatus: normalized.nameStatus,
    customerType: "individual",
    phoneCountryCode: normalized.phoneCountryCode,
    phone: normalized.phone,
    wechatId: normalized.wechatId,
    email: normalized.email,
    source: normalized.source,
    entryMethod: QUICK_ENTRY_ENTRY_METHOD,
    sourceRemark: normalized.sourceRemark,
    requestedProjectCode: normalized.requestedProjectCode,
    requestedProjectName: normalized.requestedProjectName,
    notes: normalized.notes,
    salesStage: "contacted",
    status: "public_pool",
    ownerId: null,
    releaserUserId: null,
    poolEnteredAt: now,
    poolReason: null,
    releasedBy: null,
    previousOwnerId: null,
    claimedBy: null,
    claimedAt: null,
    poolLeftAt: null,
    createdBy: actor.id,
    updatedBy: actor.id,
    deletedAt: null,
    deletedBy: null,
    deletedReason: null,
    isPinned: 0,
    pinnedAt: null,
    createdAt: now,
    updatedAt: now,
  });

  const insertAudit = database.insert(schema.auditLogs).values({
    id: crypto.randomUUID(),
    userId: actor.id,
    action: QUICK_ENTRY_CUSTOMER_AUDIT_ACTION,
    entityType: "customer",
    entityId: customerId,
    ipAddress: null,
    userAgent: null,
    metadata: JSON.stringify({
      source: normalized.source,
      entryMethod: QUICK_ENTRY_ENTRY_METHOD,
      salesStage: "contacted",
      status: "public_pool",
      creationMethod: "quick_entry",
      hasPhone: normalized.phone != null,
      hasWechat: normalized.wechatId != null,
      hasInitialNote: normalized.notes != null,
      actorRole: actor.role,
      customerCode,
    }),
    createdAt: now,
  });

  const identifierSync = buildReplaceCustomerIdentifierStatements(database, {
    customerId,
    phoneCountryCode: normalized.phoneCountryCode,
    phone: normalized.phone,
    wechatId: normalized.wechatId,
    email: normalized.email,
    secondaryContacts: [],
    now,
  });

  return {
    kind: "ready",
    customerId,
    customerCode,
    customerName: normalized.customerName,
    statements: [
      insertCustomer,
      insertAudit,
      ...identifierSync.statements,
    ],
  };
}

/**
 * Creates one customer directly in the public pool.
 *
 * Caller MUST pass a server-verified active CRM User (Admin or Staff).
 * Does not check Quick Entry grant — that belongs to the future Batch Route.
 */
export async function createCustomerDirectlyInPublicPool(input: {
  actor: User;
  customer: QuickEntryCustomerInput;
  db?: Database;
  now?: Date;
}): Promise<QuickEntryCreateResult> {
  const prepared = await prepareDirectPublicPoolCustomerCreation(input);
  if (prepared.kind === "invalid") {
    return {
      ok: false,
      errorCode: prepared.errorCode,
      message: prepared.message,
      field: prepared.field,
      validationErrors: prepared.validationErrors,
    };
  }
  if (prepared.kind === "duplicate") {
    return {
      ok: false,
      errorCode: prepared.errorCode,
      message: prepared.message,
      field: prepared.field,
      duplicate: true,
      duplicateField: prepared.duplicateField,
    };
  }

  const database = input.db ?? getDb();
  try {
    await database.batch(
      prepared.statements as unknown as Parameters<Database["batch"]>[0],
    );
  } catch (batchError) {
    if (isGlobalContactIdentifierUniqueConstraintError(batchError)) {
      const selectableSourceKeys = await getSelectableCustomerSourceKeys(database);
      const validated = validateQuickEntryCustomerInput(input.customer, {
        selectableSourceKeys,
      });
      if (validated.ok) {
        const dup = await findSafeDuplicate(validated.value, input.actor);
        if (dup) {
          return {
            ok: false,
            errorCode: dup.errorCode,
            message: dup.message,
            field: dup.field,
            duplicate: true,
            duplicateField: dup.duplicateField,
          };
        }
      }
      return {
        ok: false,
        errorCode: QUICK_ENTRY_SERVICE_ERROR_CODES.POSSIBLE_DUPLICATE,
        message: "可能存在重复客户",
        duplicate: true,
        duplicateField: "phone",
      };
    }
    throw batchError;
  }

  return {
    ok: true,
    customerId: prepared.customerId,
    customerCode: prepared.customerCode,
    customerName: prepared.customerName,
  };
}

async function findSafeDuplicate(
  normalized: QuickEntryCustomerNormalized,
  actor: User,
): Promise<QuickEntryCreateFailure | null> {
  const matches = await checkCustomerDuplicates(
    {
      phoneCountryCode: normalized.phoneCountryCode,
      phone: normalized.phone,
      wechatId: normalized.wechatId,
      email: normalized.email ?? null,
    },
    actor,
  );
  if (matches.length === 0) return null;

  const phoneMatch = matches.find((m) => m.field === "phone");
  if (phoneMatch) {
    return {
      ok: false,
      errorCode: QUICK_ENTRY_SERVICE_ERROR_CODES.DUPLICATE_PHONE,
      message: "手机号与现有客户重复",
      field: "phone",
      duplicate: true,
      duplicateField: "phone",
    };
  }

  const wechatMatch = matches.find((m) => m.field === "wechatId");
  if (wechatMatch) {
    return {
      ok: false,
      errorCode: QUICK_ENTRY_SERVICE_ERROR_CODES.DUPLICATE_WECHAT,
      message: "微信号与现有客户重复",
      field: "wechatId",
      duplicate: true,
      duplicateField: "wechatId",
    };
  }

  const emailMatch = matches.find((m) => m.field === "email");
  if (emailMatch) {
    return {
      ok: false,
      errorCode: QUICK_ENTRY_SERVICE_ERROR_CODES.DUPLICATE_EMAIL,
      message: "邮箱与现有客户重复",
      field: "email",
      duplicate: true,
      duplicateField: "email",
    };
  }

  return {
    ok: false,
    errorCode: QUICK_ENTRY_SERVICE_ERROR_CODES.POSSIBLE_DUPLICATE,
    message: "与现有客户可能重复",
    duplicate: true,
    duplicateField: matches[0]?.field,
  };
}
