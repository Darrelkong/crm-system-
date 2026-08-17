import {
  B2B_SOURCE_LEAVES,
  COOPERATION_SOURCE_LEAVES,
  DIRECT_SOURCE_MENU_ITEMS,
  OFFLINE_SOURCE_LEAVES,
  OTHER_PLATFORM_SOURCE_LEAVES,
  OTHER_SOURCE_LEAVES,
  OUTBOUND_SOURCE_LEAVES,
  OVERSEAS_SOURCE_LEAVES,
  WECHAT_SOURCE_LEAVES,
  type SourceMenuLeafSeed,
} from "./menu-data";

export type SourceMenuGroupNode = {
  kind: "group";
  /** Group-only key — never written to customers.source */
  groupKey: string;
  label: string;
  children: readonly SourceMenuLeafSeed[];
};

export type SourceMenuDirectNode = {
  kind: "direct";
  tagKey: string;
  label: string;
};

export type SourceMenuTopNode = SourceMenuGroupNode | SourceMenuDirectNode;

/** Strict top-level order (14 items). */
export const CUSTOMER_SOURCE_MENU_TOP_LEVEL: readonly SourceMenuTopNode[] = [
  {
    kind: "group",
    groupKey: "overseas_channels",
    label: "Overseas channels",
    children: OVERSEAS_SOURCE_LEAVES,
  },
  {
    kind: "group",
    groupKey: "wechat",
    label: "微信",
    children: WECHAT_SOURCE_LEAVES,
  },
  {
    kind: "direct",
    tagKey: "xiaohongshu",
    label: "小红书",
  },
  {
    kind: "direct",
    tagKey: "douyin",
    label: "抖音",
  },
  {
    kind: "group",
    groupKey: "other_platform",
    label: "其他平台",
    children: OTHER_PLATFORM_SOURCE_LEAVES,
  },
  {
    kind: "direct",
    tagKey: "company_website",
    label: "公司官网",
  },
  {
    kind: "direct",
    tagKey: "referral",
    label: "客户转介绍",
  },
  {
    kind: "direct",
    tagKey: "agent_client",
    label: "代理渠道",
  },
  {
    kind: "group",
    groupKey: "cooperation_channels",
    label: "合作渠道",
    children: COOPERATION_SOURCE_LEAVES,
  },
  {
    kind: "group",
    groupKey: "b2b_platforms",
    label: "企业 / B2B平台",
    children: B2B_SOURCE_LEAVES,
  },
  {
    kind: "group",
    groupKey: "outbound_development",
    label: "主动开发",
    children: OUTBOUND_SOURCE_LEAVES,
  },
  {
    kind: "group",
    groupKey: "offline_channels",
    label: "线下渠道",
    children: OFFLINE_SOURCE_LEAVES,
  },
  {
    kind: "direct",
    tagKey: "inbound_inquiry",
    label: "主动咨询",
  },
  {
    kind: "group",
    groupKey: "other_sources",
    label: "其他",
    children: OTHER_SOURCE_LEAVES,
  },
] as const;

const GROUP_CHILDREN = CUSTOMER_SOURCE_MENU_TOP_LEVEL.flatMap((node) =>
  node.kind === "group" ? [...node.children] : [],
);

const DIRECT_ITEMS = CUSTOMER_SOURCE_MENU_TOP_LEVEL.flatMap((node) =>
  node.kind === "direct" ? [node] : [],
);

export const CONFIGURED_MENU_LEAF_KEYS: readonly string[] = [
  ...GROUP_CHILDREN.map((leaf) => leaf.tagKey),
  ...DIRECT_ITEMS.map((leaf) => leaf.tagKey),
];

const MENU_GROUP_KEYS = new Set(
  CUSTOMER_SOURCE_MENU_TOP_LEVEL.filter((node) => node.kind === "group").map(
    (node) => (node as SourceMenuGroupNode).groupKey,
  ),
);

const MENU_LEAF_KEY_SET = new Set(CONFIGURED_MENU_LEAF_KEYS);

const LEAF_PARENT_MAP = new Map<
  string,
  { groupKey: string; groupLabel: string; leafLabel: string }
>();

for (const node of CUSTOMER_SOURCE_MENU_TOP_LEVEL) {
  if (node.kind === "group") {
    for (const child of node.children) {
      LEAF_PARENT_MAP.set(child.tagKey, {
        groupKey: node.groupKey,
        groupLabel: node.label,
        leafLabel: child.label,
      });
    }
  }
}

for (const node of CUSTOMER_SOURCE_MENU_TOP_LEVEL) {
  if (node.kind === "direct") {
    LEAF_PARENT_MAP.set(node.tagKey, {
      groupKey: node.tagKey,
      groupLabel: node.label,
      leafLabel: node.label,
    });
  }
}

export function isMenuGroupKey(key: string): boolean {
  return MENU_GROUP_KEYS.has(key);
}

export function isConfiguredMenuLeafKey(key: string): boolean {
  return MENU_LEAF_KEY_SET.has(key);
}

export function getConfiguredMenuLeafKeys(): readonly string[] {
  return CONFIGURED_MENU_LEAF_KEYS;
}

export function getMenuGroupKeys(): readonly string[] {
  return [...MENU_GROUP_KEYS];
}

export type SourceDisplayPath = {
  groupLabel: string | null;
  leafLabel: string;
  /** Human-readable path, e.g. `微信 / 视频号` or `小红书` */
  displayLabel: string;
};

export function resolveSourceMenuDisplayPath(
  tagKey: string,
  labelOverride?: string | null,
): SourceDisplayPath | null {
  const mapped = LEAF_PARENT_MAP.get(tagKey);
  if (!mapped) {
    if (!labelOverride) return null;
    return {
      groupLabel: null,
      leafLabel: labelOverride,
      displayLabel: labelOverride,
    };
  }

  const leafLabel = labelOverride ?? mapped.leafLabel;
  if (mapped.groupKey === tagKey) {
    return {
      groupLabel: null,
      leafLabel,
      displayLabel: leafLabel,
    };
  }

  return {
    groupLabel: mapped.groupLabel,
    leafLabel,
    displayLabel: `${mapped.groupLabel} / ${leafLabel}`,
  };
}

/** Existing production keys reused by the menu (not new inserts). */
export const REUSED_EXISTING_MENU_TAG_KEYS = [
  "xiaohongshu",
  "douyin",
  "referral",
  "agent_client",
  "xianyu_taobao",
  "other",
] as const;

export function countMenuTagStats(): {
  configuredLeafCount: number;
  reusedExistingTagCount: number;
  newTagCount: number;
} {
  const configuredLeafCount = CONFIGURED_MENU_LEAF_KEYS.length;
  const reusedExistingTagCount = REUSED_EXISTING_MENU_TAG_KEYS.length;
  return {
    configuredLeafCount,
    reusedExistingTagCount,
    newTagCount: configuredLeafCount - reusedExistingTagCount,
  };
}

export function collectMenuTagSeedsForMigration(): SourceMenuLeafSeed[] {
  const seeds: SourceMenuLeafSeed[] = [];
  const seen = new Set<string>();

  for (const node of CUSTOMER_SOURCE_MENU_TOP_LEVEL) {
    if (node.kind === "group") {
      for (const child of node.children) {
        if (seen.has(child.tagKey)) continue;
        seen.add(child.tagKey);
        seeds.push(child);
      }
    } else {
      if (seen.has(node.tagKey)) continue;
      seen.add(node.tagKey);
      seeds.push({ tagKey: node.tagKey, label: node.label });
    }
  }

  return seeds;
}
