import { CUSTOMER_SOURCE_LABELS } from "@/lib/constants/customer-source-labels";
import {
  INTERNAL_SOURCE_LABEL_FALLBACKS,
  isInternalReadableSourceKey,
} from "./legacy";
import { resolveSourceMenuDisplayPath } from "./menu";

/**
 * Resolve a customer source label for display.
 *
 * Precedence:
 * 1. DB label from labelMap (active or inactive tags)
 * 2. Internal / legacy fallback (only when DB has no entry)
 * 3. Static constant fallback (only when DB has no entry)
 * 4. Raw key
 */
export function resolveCustomerSourceLabel(
  tagKey: string,
  labelMap: ReadonlyMap<string, string>,
): string {
  const dbLabel = labelMap.get(tagKey);
  if (dbLabel) {
    return dbLabel;
  }

  if (isInternalReadableSourceKey(tagKey)) {
    return INTERNAL_SOURCE_LABEL_FALLBACKS[tagKey] ?? tagKey;
  }

  const constantLabel =
    CUSTOMER_SOURCE_LABELS[tagKey as keyof typeof CUSTOMER_SOURCE_LABELS];
  if (constantLabel) {
    return constantLabel;
  }

  return tagKey;
}

/**
 * Full display path using menu grouping when available.
 * Falls back to resolveCustomerSourceLabel for custom / legacy keys.
 */
export function resolveCustomerSourceDisplayLabel(
  tagKey: string,
  labelMap: ReadonlyMap<string, string>,
): string {
  const leafLabel = resolveCustomerSourceLabel(tagKey, labelMap);
  const path = resolveSourceMenuDisplayPath(tagKey, leafLabel);
  return path?.displayLabel ?? leafLabel;
}
