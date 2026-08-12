import { and, eq, isNull, ne, or, sql } from "drizzle-orm";
import type { Customer } from "../../../../drizzle/schema/customers";
import type { User } from "../../../../drizzle/schema/users";
import {
  normalizeCustomerEmail,
  normalizeCustomerPhone,
  normalizeCustomerWechat,
} from "@/lib/customers/contact-normalization";
import { buildSearchWhere } from "@/lib/customers/queries";
import { schema, type Database } from "@/lib/db";
import { getCustomerAccessLevel } from "@/lib/permissions/customers";
import { FAMILY_ERROR_CODES, FamilyLinkError } from "./errors";
import {
  assertFamilyTargetEligible,
  resolveFamilyLinkMode,
} from "./family-permissions";

const CANDIDATE_LIMIT = 8;
const MIN_BROAD_SEARCH_LENGTH = 2;

export type FamilyCandidateVisible = {
  isMasked: false;
  customerId: string;
  customerName: string;
  customerCode: string | null;
  linkMode: "direct" | "approval";
};

export type FamilyCandidateProtected = {
  isMasked: true;
  requiresApproval: true;
};

export type FamilyCandidateResult = FamilyCandidateVisible | FamilyCandidateProtected;

export type ProtectedLookupKind =
  | "customerCode"
  | "phone"
  | "wechatId"
  | "email";

export type ProtectedLookup = {
  kind: ProtectedLookupKind;
  value: string;
};

function staffVisibleWhere(user: User) {
  if (user.role === "admin") {
    return undefined;
  }

  return or(
    eq(schema.customers.ownerId, user.id),
    sql`EXISTS (
      SELECT 1 FROM customer_assignees ca
      WHERE ca.customer_id = ${schema.customers.id}
        AND ca.user_id = ${user.id}
    )`,
  );
}

function baseCandidateWhere(sourceId: string) {
  return and(
    ne(schema.customers.id, sourceId),
    eq(schema.customers.customerType, "individual"),
    isNull(schema.customers.deletedAt),
    sql`${schema.customers.status} != 'archived'`,
  );
}

function detectProtectedLookup(
  query: string,
): ProtectedLookup | null {
  const trimmed = query.trim();
  if (!trimmed) {
    return null;
  }

  if (/^EF\d{6}$/i.test(trimmed)) {
    return { kind: "customerCode", value: trimmed.toUpperCase() };
  }

  const email = normalizeCustomerEmail(trimmed);
  if (email && trimmed.includes("@")) {
    return { kind: "email", value: email };
  }

  const wechat = normalizeCustomerWechat(trimmed);
  if (wechat && /^[a-zA-Z]/.test(trimmed)) {
    return { kind: "wechatId", value: wechat };
  }

  const phone = normalizeCustomerPhone("+86", trimmed) ??
    normalizeCustomerPhone(null, trimmed);
  if (phone && /^\+?\d[\d\s-]{5,}$/.test(trimmed)) {
    return { kind: "phone", value: phone };
  }

  return null;
}

async function mapVisibleCandidate(
  db: Database,
  user: User,
  customer: Customer,
): Promise<FamilyCandidateVisible | null> {
  const isAssignee =
    user.role === "staff"
      ? (
          await db
            .select({ id: schema.customerAssignees.id })
            .from(schema.customerAssignees)
            .where(
              and(
                eq(schema.customerAssignees.customerId, customer.id),
                eq(schema.customerAssignees.userId, user.id),
              ),
            )
            .limit(1)
        ).length > 0
      : false;

  const accessLevel = getCustomerAccessLevel(user, customer, { isAssignee });
  if (accessLevel !== "full") {
    return null;
  }

  return {
    isMasked: false,
    customerId: customer.id,
    customerName: customer.customerName,
    customerCode: customer.customerCode ?? null,
    linkMode: resolveFamilyLinkMode(user, customer, isAssignee),
  };
}

export async function searchFamilyCandidates(
  db: Database,
  user: User,
  source: Customer,
  query: string,
): Promise<FamilyCandidateResult[]> {
  const trimmed = query.trim();
  if (!trimmed) {
    return [];
  }

  const protectedLookup = detectProtectedLookup(trimmed);
  if (protectedLookup) {
    const exactRows = await findEligibleExactMatches(db, source.id, protectedLookup);
    if (exactRows.length === 1) {
      const visible = await mapVisibleCandidate(db, user, exactRows[0]!);
      if (visible) {
        return [visible];
      }
    }

    const protectedResult = await resolveProtectedExactLookup(
      db,
      user,
      source.id,
      protectedLookup,
    );
    return protectedResult ? [protectedResult] : [];
  }

  if (trimmed.length < MIN_BROAD_SEARCH_LENGTH) {
    return [];
  }

  const where = and(
    baseCandidateWhere(source.id),
    buildSearchWhere(trimmed),
    staffVisibleWhere(user),
  );

  const rows = await db
    .select()
    .from(schema.customers)
    .where(where)
    .limit(CANDIDATE_LIMIT);

  const results: FamilyCandidateVisible[] = [];
  for (const row of rows) {
    const candidate = await mapVisibleCandidate(db, user, row);
    if (candidate) {
      results.push(candidate);
    }
  }

  return results;
}

export async function resolveProtectedExactLookup(
  db: Database,
  user: User,
  sourceId: string,
  lookup: ProtectedLookup,
): Promise<FamilyCandidateProtected | null> {
  const rows = await findEligibleExactMatches(db, sourceId, lookup);
  if (rows.length === 0) {
    return null;
  }

  if (rows.length > 1) {
    const distinctIds = new Set(rows.map((row) => row.id));
    if (distinctIds.size > 1) {
      throw new FamilyLinkError(
        409,
        "请联系管理员确认目标客户",
        FAMILY_ERROR_CODES.PROTECTED_MATCH_AMBIGUOUS,
      );
    }
  }

  const target = rows[0]!;
  const isAssignee =
    user.role === "staff"
      ? (
          await db
            .select({ id: schema.customerAssignees.id })
            .from(schema.customerAssignees)
            .where(
              and(
                eq(schema.customerAssignees.customerId, target.id),
                eq(schema.customerAssignees.userId, user.id),
              ),
            )
            .limit(1)
        ).length > 0
      : false;

  const accessLevel = getCustomerAccessLevel(user, target, { isAssignee });
  if (accessLevel === "full") {
    return null;
  }

  return { isMasked: true, requiresApproval: true };
}

async function findEligibleExactMatches(
  db: Database,
  sourceId: string,
  lookup: ProtectedLookup,
): Promise<Customer[]> {
  const base = and(
    baseCandidateWhere(sourceId),
    eq(schema.customers.customerType, "individual"),
    isNull(schema.customers.deletedAt),
    sql`${schema.customers.status} != 'archived'`,
  );

  let identifierWhere;
  switch (lookup.kind) {
    case "customerCode":
      identifierWhere = eq(
        schema.customers.customerCode,
        lookup.value.toUpperCase(),
      );
      break;
    case "email":
      identifierWhere = sql`lower(${schema.customers.email}) = ${lookup.value}`;
      break;
    case "wechatId":
      identifierWhere = sql`lower(${schema.customers.wechatId}) = ${lookup.value}`;
      break;
    case "phone": {
      const phoneIdentity = lookup.value;
      identifierWhere = sql`(
        ${schema.customers.phoneCountryCode} || ${schema.customers.phone}
      ) = ${phoneIdentity.replace(/\s/g, "")} OR ${schema.customers.phone} = ${lookup.value}`;
      break;
    }
  }

  return db
    .select()
    .from(schema.customers)
    .where(and(base, identifierWhere))
    .limit(3);
}

export async function resolveTargetFromProtectedLookup(
  db: Database,
  sourceId: string,
  lookup: ProtectedLookup,
): Promise<Customer> {
  const rows = await findEligibleExactMatches(db, sourceId, lookup);
  if (rows.length === 0) {
    throw new FamilyLinkError(
      404,
      "目标客户不存在",
      FAMILY_ERROR_CODES.TARGET_NOT_FOUND,
    );
  }

  const distinctIds = new Set(rows.map((row) => row.id));
  if (distinctIds.size > 1) {
    throw new FamilyLinkError(
      409,
      "请联系管理员确认目标客户",
      FAMILY_ERROR_CODES.PROTECTED_MATCH_AMBIGUOUS,
    );
  }

  const target = rows[0]!;
  assertFamilyTargetEligible(target);
  return target;
}

export async function resolveTargetFromVisibleId(
  db: Database,
  user: User,
  sourceId: string,
  targetCustomerId: string,
): Promise<Customer> {
  const rows = await db
    .select()
    .from(schema.customers)
    .where(
      and(
        eq(schema.customers.id, targetCustomerId),
        ne(schema.customers.id, sourceId),
        isNull(schema.customers.deletedAt),
      ),
    )
    .limit(1);

  const target = rows[0];
  if (!target) {
    throw new FamilyLinkError(
      404,
      "目标客户不存在",
      FAMILY_ERROR_CODES.TARGET_NOT_FOUND,
    );
  }

  assertFamilyTargetEligible(target);

  const isAssignee =
    user.role === "staff"
      ? (
          await db
            .select({ id: schema.customerAssignees.id })
            .from(schema.customerAssignees)
            .where(
              and(
                eq(schema.customerAssignees.customerId, target.id),
                eq(schema.customerAssignees.userId, user.id),
              ),
            )
            .limit(1)
        ).length > 0
      : false;

  const accessLevel = getCustomerAccessLevel(user, target, { isAssignee });
  if (accessLevel !== "full") {
    throw new FamilyLinkError(
      403,
      "无权直接关联该客户",
      FAMILY_ERROR_CODES.LINK_APPROVAL_REQUIRED,
    );
  }

  return target;
}
