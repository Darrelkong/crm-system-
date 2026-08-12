import { and, eq, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import type { Customer } from "../../../../drizzle/schema/customers";
import type { User } from "../../../../drizzle/schema/users";
import {
  normalizeCustomerEmail,
  normalizeCustomerPhone,
  normalizeCustomerWechat,
  normalizePhoneNationalNumber,
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
const PHONE_EXACT_SCAN_LIMIT = 12;

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

export type FamilyCandidateSearchMode = "broad" | "exact";

export type FamilyCandidateSearchInput = {
  q: string;
  mode: FamilyCandidateSearchMode;
  kind?: ProtectedLookupKind;
};

const PROTECTED_LOOKUP_KINDS = new Set<ProtectedLookupKind>([
  "customerCode",
  "phone",
  "wechatId",
  "email",
]);

export function parseFamilyCandidateSearchInput(raw: {
  q?: string | null;
  mode?: string | null;
  kind?: string | null;
}): FamilyCandidateSearchInput {
  const q = (raw.q ?? "").trim();
  const mode: FamilyCandidateSearchMode = raw.mode === "exact" ? "exact" : "broad";

  if (mode === "broad") {
    return { q, mode };
  }

  const kind = raw.kind;
  if (!kind || !PROTECTED_LOOKUP_KINDS.has(kind as ProtectedLookupKind)) {
    throw new FamilyLinkError(
      400,
      "无效的精确查找方式",
      FAMILY_ERROR_CODES.INVALID_SEARCH_PARAMS,
    );
  }

  if (!q) {
    throw new FamilyLinkError(
      400,
      "请输入查找内容",
      FAMILY_ERROR_CODES.INVALID_SEARCH_PARAMS,
    );
  }

  return { q, mode, kind: kind as ProtectedLookupKind };
}

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

function assigneeExistsSql(userId: string) {
  return sql`EXISTS (
    SELECT 1 FROM customer_assignees ca
    WHERE ca.customer_id = ${schema.customers.id}
      AND ca.user_id = ${userId}
  )`;
}

function mapVisibleCandidateFromRow(
  user: User,
  customer: Customer,
  isAssignee: boolean,
): FamilyCandidateVisible | null {
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

  return mapVisibleCandidateFromRow(user, customer, isAssignee);
}

function customerPhoneIdentity(customer: Customer): string | null {
  return normalizeCustomerPhone(customer.phoneCountryCode, customer.phone);
}

type PhoneExactInput =
  | { variant: "international"; identity: string }
  | { variant: "national"; national: string };

export function parsePhoneExactInput(raw: string): PhoneExactInput | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }

  const compact = trimmed.replace(/[\s\-()（）]/g, "");
  if (compact.startsWith("+")) {
    const digits = compact.slice(1).replace(/\D/g, "");
    if (digits.length < 5) {
      return null;
    }
    return { variant: "international", identity: `+${digits}` };
  }

  if (!/^[\d\s\-()（）+]{5,}$/.test(trimmed)) {
    return null;
  }

  const national = normalizePhoneNationalNumber(trimmed);
  if (!national || national.length < 5) {
    return null;
  }

  return { variant: "national", national };
}

function buildExactLookup(kind: ProtectedLookupKind, q: string): ProtectedLookup {
  switch (kind) {
    case "customerCode":
      return { kind, value: q.trim().toUpperCase() };
    case "email": {
      const email = normalizeCustomerEmail(q);
      if (!email) {
        throw new FamilyLinkError(
          400,
          "无效的邮箱格式",
          FAMILY_ERROR_CODES.INVALID_SEARCH_PARAMS,
        );
      }
      return { kind, value: email };
    }
    case "wechatId": {
      const wechat = normalizeCustomerWechat(q);
      if (!wechat) {
        throw new FamilyLinkError(
          400,
          "无效的微信号",
          FAMILY_ERROR_CODES.INVALID_SEARCH_PARAMS,
        );
      }
      return { kind, value: wechat };
    }
    case "phone":
      return { kind, value: q.trim() };
  }
}

async function searchBroadFamilyCandidates(
  db: Database,
  user: User,
  source: Customer,
  query: string,
): Promise<FamilyCandidateResult[]> {
  const trimmed = query.trim();
  if (!trimmed || trimmed.length < MIN_BROAD_SEARCH_LENGTH) {
    return [];
  }

  const where = and(
    baseCandidateWhere(source.id),
    buildSearchWhere(trimmed),
    staffVisibleWhere(user),
  );

  const rows = await db
    .select({
      customer: schema.customers,
      isAssignee:
        user.role === "staff"
          ? sql<number>`CASE WHEN ${assigneeExistsSql(user.id)} THEN 1 ELSE 0 END`
          : sql<number>`0`,
    })
    .from(schema.customers)
    .where(where)
    .limit(CANDIDATE_LIMIT);

  const results: FamilyCandidateVisible[] = [];
  for (const row of rows) {
    const candidate = mapVisibleCandidateFromRow(
      user,
      row.customer,
      row.isAssignee === 1,
    );
    if (candidate) {
      results.push(candidate);
    }
  }

  return results;
}

async function searchExactFamilyCandidates(
  db: Database,
  user: User,
  source: Customer,
  kind: ProtectedLookupKind,
  query: string,
): Promise<FamilyCandidateResult[]> {
  const lookup = buildExactLookup(kind, query);
  const exactRows = await findEligibleExactMatches(db, source.id, lookup);

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
    lookup,
  );
  return protectedResult ? [protectedResult] : [];
}

export async function searchFamilyCandidates(
  db: Database,
  user: User,
  source: Customer,
  input: FamilyCandidateSearchInput,
): Promise<FamilyCandidateResult[]> {
  if (input.mode === "exact") {
    if (!input.kind) {
      throw new FamilyLinkError(
        400,
        "无效的精确查找方式",
        FAMILY_ERROR_CODES.INVALID_SEARCH_PARAMS,
      );
    }
    return searchExactFamilyCandidates(db, user, source, input.kind, input.q);
  }

  return searchBroadFamilyCandidates(db, user, source, input.q);
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

async function findPhoneExactMatches(
  db: Database,
  sourceId: string,
  rawPhone: string,
): Promise<Customer[]> {
  const parsed = parsePhoneExactInput(rawPhone);
  if (!parsed) {
    return [];
  }

  const base = and(
    baseCandidateWhere(sourceId),
    isNotNull(schema.customers.phone),
  );

  if (parsed.variant === "international") {
    const rows = await db
      .select()
      .from(schema.customers)
      .where(
        and(
          base,
          isNotNull(schema.customers.phone),
          isNotNull(schema.customers.phoneCountryCode),
          sql`replace(replace(${schema.customers.phoneCountryCode} || ${schema.customers.phone}, ' ', ''), '-', '') = ${parsed.identity}`,
        ),
      )
      .limit(3);

    return rows.filter(
      (customer) => customerPhoneIdentity(customer) === parsed.identity,
    );
  }

  const rows = await db
    .select()
    .from(schema.customers)
    .where(
      and(
        base,
        sql`replace(replace(replace(replace(${schema.customers.phone}, ' ', ''), '-', ''), '(', ''), ')', '') = ${parsed.national}`,
      ),
    )
    .limit(PHONE_EXACT_SCAN_LIMIT);

  const matches = rows.filter(
    (customer) => normalizePhoneNationalNumber(customer.phone) === parsed.national,
  );

  const identities = new Set(
    matches
      .map((customer) => customerPhoneIdentity(customer))
      .filter((identity): identity is string => identity != null),
  );

  if (identities.size > 1) {
    throw new FamilyLinkError(
      409,
      "请联系管理员确认目标客户",
      FAMILY_ERROR_CODES.PROTECTED_MATCH_AMBIGUOUS,
    );
  }

  return matches;
}

async function findEligibleExactMatches(
  db: Database,
  sourceId: string,
  lookup: ProtectedLookup,
): Promise<Customer[]> {
  const base = baseCandidateWhere(sourceId);

  if (lookup.kind === "phone") {
    return findPhoneExactMatches(db, sourceId, lookup.value);
  }

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
    default:
      return [];
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
