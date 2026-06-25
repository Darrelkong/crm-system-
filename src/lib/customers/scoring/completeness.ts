import { isPublicPoolCustomer } from "@/lib/permissions/customers";
import type { Customer } from "../../../../drizzle/schema/customers";

function hasText(value: string | null | undefined): boolean {
  return !!value && value.trim().length > 0;
}

export type CompletenessResult = {
  completenessScore: number;
  completenessMissingFields: string[];
};

export function calculateDataCompletenessScore(
  customer: Customer,
  hasFollowUp: boolean,
): CompletenessResult {
  let score = 0;
  const missing: string[] = [];

  if (hasText(customer.customerName)) {
    score += 10;
  } else {
    missing.push("customer_name");
  }

  if (hasText(customer.phone) || hasText(customer.wechatId)) {
    score += 20;
  } else {
    missing.push("phone_or_wechat");
  }

  if (hasText(customer.email)) {
    score += 10;
  } else {
    missing.push("email");
  }

  if (hasText(customer.source)) {
    score += 10;
  } else {
    missing.push("source");
  }

  if (hasText(customer.salesStage)) {
    score += 10;
  } else {
    missing.push("sales_stage");
  }

  const poolCustomer = isPublicPoolCustomer(customer);
  if (hasText(customer.ownerId)) {
    score += 10;
  } else if (!poolCustomer) {
    missing.push("owner_id");
  }

  if (hasText(customer.notes)) {
    score += 10;
  } else {
    missing.push("notes");
  }

  if (hasFollowUp) {
    score += 10;
  } else {
    missing.push("follow_up");
  }

  if (hasText(customer.nextFollowUpAt)) {
    score += 10;
  } else {
    missing.push("next_follow_up_at");
  }

  return {
    completenessScore: score,
    completenessMissingFields: missing,
  };
}
