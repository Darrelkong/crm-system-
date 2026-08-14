import { FAMILY_ERROR_CODES, FamilyLinkError } from "./errors";

export function mapBatchUniqueConstraintError(error: unknown): FamilyLinkError | null {
  const message = error instanceof Error ? error.message : String(error);
  if (!/UNIQUE constraint failed/i.test(message)) {
    return null;
  }
  if (/customer_household_members/i.test(message)) {
    return new FamilyLinkError(
      409,
      "家庭成员状态冲突",
      FAMILY_ERROR_CODES.HOUSEHOLD_CONFLICT,
    );
  }
  if (/customer_household_relationships/i.test(message)) {
    return new FamilyLinkError(
      409,
      "该客户已是家庭成员",
      FAMILY_ERROR_CODES.LINK_ALREADY_EXISTS,
    );
  }
  if (/customers\.customer_code/i.test(message) || /customer_code/i.test(message)) {
    return null;
  }
  return null;
}
