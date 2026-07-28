/**
 * Map 0042 global identifier unique-constraint failures to Phase 1 duplicate 409.
 * Does not parse PII from SQLite error text — re-runs checkCustomerDuplicates instead.
 *
 * 0041 per-customer unique failures are NOT mapped to cross-customer duplicates
 * when the error signature still includes customer_id / per-customer index name.
 */

import type { User } from "../../../drizzle/schema/users";
import {
  checkCustomerDuplicates,
  type DuplicateMatch,
} from "@/lib/customers/duplicate-check";
import {
  classifyContactIdentifierUniqueConstraintError,
  isGlobalContactIdentifierUniqueConstraintError,
} from "@/lib/customers/contact-identifiers";

export type IdentifierConstraintDuplicateResult = {
  duplicates: DuplicateMatch[];
};

export async function resolveIdentifierConstraintAsDuplicates(
  error: unknown,
  input: {
    phoneCountryCode?: string | null;
    phone?: string | null;
    wechatId?: string | null;
    email?: string | null;
  },
  currentUser: User,
  excludeCustomerId?: string,
): Promise<IdentifierConstraintDuplicateResult | null> {
  const kind = classifyContactIdentifierUniqueConstraintError(error);
  if (kind !== "global") {
    return null;
  }

  const duplicates = await checkCustomerDuplicates(
    {
      phoneCountryCode: input.phoneCountryCode,
      phone: input.phone,
      wechatId: input.wechatId,
      email: input.email,
    },
    currentUser,
    excludeCustomerId,
  );

  // Never invent customer rows. Empty list → safe generic 409 body.
  return { duplicates };
}

export function duplicateCustomerConflictResponse(
  duplicates: DuplicateMatch[],
): Response {
  return Response.json(
    {
      error: "存在重复客户",
      errorCode: "DUPLICATE_CUSTOMER",
      code: "duplicate_customer",
      duplicate: true,
      duplicates,
    },
    { status: 409 },
  );
}

/** Re-export for call sites that only need the global gate. */
export { isGlobalContactIdentifierUniqueConstraintError };
