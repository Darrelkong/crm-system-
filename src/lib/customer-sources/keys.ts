import type { Database } from "@/lib/db";
import {
  getConfiguredMenuLeafKeys,
  isConfiguredMenuLeafKey,
  isMenuGroupKey,
  CUSTOMER_SOURCE_MENU_TOP_LEVEL,
} from "./menu";
import {
  isLegacyHiddenSourceKey,
  isWritableInternalSourceKey,
} from "./legacy";
import { isRetiredFormalSourceKey } from "./retired";
import { listCustomerTags, type CustomerTagListItem } from "@/lib/customer-tags/queries";

export function isMenuGroupSourceKey(key: string): boolean {
  return isMenuGroupKey(key);
}

/** Keys that may appear on historical records and in read-only displays. */
export function isReadableCustomerSourceKey(
  key: string,
  allTags: readonly CustomerTagListItem[],
): boolean {
  if (!key) return false;
  if (allTags.some((tag) => tag.tagKey === key)) return true;
  if (isLegacyHiddenSourceKey(key)) return true;
  if (isWritableInternalSourceKey(key)) return true;
  return isConfiguredMenuLeafKey(key);
}

function isEligibleCustomSelectableTag(tag: CustomerTagListItem): boolean {
  return (
    tag.isActive &&
    !isWritableInternalSourceKey(tag.tagKey) &&
    !isLegacyHiddenSourceKey(tag.tagKey) &&
    !isRetiredFormalSourceKey(tag.tagKey) &&
    !isConfiguredMenuLeafKey(tag.tagKey)
  );
}

/**
 * Formal menu leaves: active DB tag AND configured menu leaf (intersection).
 * Does not include keys that exist only in code config without a DB row.
 */
export function computeFormalMenuSelectableKeys(
  tags: readonly CustomerTagListItem[],
): string[] {
  const activeTagKeys = new Set(
    tags.filter((tag) => tag.isActive).map((tag) => tag.tagKey),
  );

  return getConfiguredMenuLeafKeys().filter((leafKey) =>
    activeTagKeys.has(leafKey),
  );
}

/** Active custom admin tags not in the formal menu config. */
export function computeEligibleCustomSelectableKeys(
  tags: readonly CustomerTagListItem[],
): string[] {
  return tags
    .filter(isEligibleCustomSelectableTag)
    .map((tag) => tag.tagKey)
    .sort();
}

/**
 * Writable/selectable keys for create, edit (when changed), and import:
 * (active DB tags ∩ configured menu leaf keys) + eligible active custom tags.
 */
export function computeSelectableCustomerSourceKeys(
  tags: readonly CustomerTagListItem[],
): string[] {
  const selectable = new Set<string>([
    ...computeFormalMenuSelectableKeys(tags),
    ...computeEligibleCustomSelectableKeys(tags),
  ]);
  return [...selectable].sort();
}

export async function getSelectableCustomerSourceKeys(
  db: Database,
): Promise<string[]> {
  const tags = await listCustomerTags(db);
  return computeSelectableCustomerSourceKeys(tags);
}

export function assertWritableCustomerSourceKey(
  key: string,
  selectableKeys: readonly string[],
): boolean {
  if (isMenuGroupSourceKey(key)) return false;
  if (isWritableInternalSourceKey(key)) return false;
  if (isLegacyHiddenSourceKey(key)) return false;
  if (isRetiredFormalSourceKey(key)) return false;
  return selectableKeys.includes(key);
}

export type CustomerSourceMenuOption =
  | {
      kind: "direct";
      tagKey: string;
      label: string;
    }
  | {
      kind: "group";
      groupKey: string;
      label: string;
      children: { tagKey: string; label: string }[];
    }
  | {
      kind: "custom";
      tagKey: string;
      label: string;
    };

export async function buildCustomerSourceMenuOptions(
  db: Database,
): Promise<CustomerSourceMenuOption[]> {
  const tags = await listCustomerTags(db);
  const labelByKey = new Map(tags.map((tag) => [tag.tagKey, tag.label]));
  const activeKeys = new Set(
    tags.filter((tag) => tag.isActive).map((tag) => tag.tagKey),
  );

  const options: CustomerSourceMenuOption[] = [];

  for (const node of CUSTOMER_SOURCE_MENU_TOP_LEVEL) {
    if (node.kind === "direct") {
      if (!activeKeys.has(node.tagKey)) continue;
      options.push({
        kind: "direct",
        tagKey: node.tagKey,
        label: labelByKey.get(node.tagKey) ?? node.label,
      });
      continue;
    }

    const children = node.children
      .filter((child) => activeKeys.has(child.tagKey))
      .map((child) => ({
        tagKey: child.tagKey,
        label: labelByKey.get(child.tagKey) ?? child.label,
      }));

    if (children.length === 0) continue;

    options.push({
      kind: "group",
      groupKey: node.groupKey,
      label: node.label,
      children,
    });
  }

  const customTags = tags.filter(isEligibleCustomSelectableTag);

  for (const tag of customTags) {
    options.push({
      kind: "custom",
      tagKey: tag.tagKey,
      label: tag.label,
    });
  }

  return options;
}
