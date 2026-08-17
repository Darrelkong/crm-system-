import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CUSTOMER_SOURCE_MENU_TOP_LEVEL,
  countMenuTagStats,
  getConfiguredMenuLeafKeys,
  isMenuGroupKey,
  resolveSourceMenuDisplayPath,
} from "./menu";
import {
  assertWritableCustomerSourceKey,
  computeEligibleCustomSelectableKeys,
  computeFormalMenuSelectableKeys,
  computeSelectableCustomerSourceKeys,
  isMenuGroupSourceKey,
} from "./keys";
import { resolveCustomerSourceLabel } from "./resolver";
import { validateCustomerInput } from "@/lib/customers/validation";
import {
  assertTagDeletable,
  assertTagDeactivatable,
} from "@/lib/customer-tags/service";
import { CUSTOMER_SOURCE_OTHER_KEY } from "@/lib/customer-tags/constants";
import type { CustomerTagListItem } from "@/lib/customer-tags/queries";
import { PUBLIC_POOL_QUICK_ENTRY_SOURCE_KEY } from "@/lib/constants/customer-sources";
import { resolveCustomerSourceDisplayLabel } from "./resolver";
import { RETIRED_FORMAL_SOURCE_KEYS } from "./retired";
import { OTHER_PLATFORM_SOURCE_LEAVES, OVERSEAS_SOURCE_LEAVES } from "./menu-data";

const TOP_LEVEL_LABELS = CUSTOMER_SOURCE_MENU_TOP_LEVEL.map((node) =>
  node.kind === "group" ? node.label : node.label,
);

const OTHER_PLATFORM_CHILD_LABELS = OTHER_PLATFORM_SOURCE_LEAVES.map(
  (leaf) => leaf.label,
);

describe("customer source menu phase 1 (final 14 top-level)", () => {
  it("has exactly 14 top-level menu items in required order", () => {
    assert.equal(CUSTOMER_SOURCE_MENU_TOP_LEVEL.length, 14);
    assert.deepEqual(TOP_LEVEL_LABELS, [
      "Overseas channels",
      "微信",
      "小红书",
      "抖音",
      "其他平台",
      "公司官网",
      "客户转介绍",
      "代理渠道",
      "合作渠道",
      "企业 / B2B平台",
      "主动开发",
      "线下渠道",
      "主动咨询",
      "其他",
    ]);
  });

  it("places Overseas channels first and 微信 second", () => {
    assert.equal(TOP_LEVEL_LABELS[0], "Overseas channels");
    assert.equal(TOP_LEVEL_LABELS[1], "微信");
  });

  it("has direct sources for 小红书 and 抖音", () => {
    const directKeys = CUSTOMER_SOURCE_MENU_TOP_LEVEL.filter(
      (node) => node.kind === "direct",
    ).map((node) => (node as { tagKey: string }).tagKey);
    assert.deepEqual(directKeys, [
      "xiaohongshu",
      "douyin",
      "company_website",
      "referral",
      "agent_client",
      "inbound_inquiry",
    ]);
  });

  it("其他平台 group contains required flat children only", () => {
    const otherPlatform = CUSTOMER_SOURCE_MENU_TOP_LEVEL.find(
      (node) => node.kind === "group" && node.groupKey === "other_platform",
    );
    assert.ok(otherPlatform && otherPlatform.kind === "group");
    assert.deepEqual(
      otherPlatform.children.map((child) => child.label),
      OTHER_PLATFORM_CHILD_LABELS,
    );
    assert.deepEqual(
      otherPlatform.children.map((child) => child.tagKey),
      [
        "kuaishou",
        "xianyu_taobao",
        "xianyu",
        "pinduoduo",
        "zhihu",
        "bilibili",
        "toutiao",
        "xigua_video",
        "baijiahao",
        "baidu_zhidao",
        "baidu_jingyan",
        "baidu_tieba",
        "qq",
        "ifeng",
        "yidian",
        "uc_toutiao",
        "douban",
        "jianshu",
        "csdn",
        "cnblogs",
        "segmentfault",
        "oschina",
        "zsxq",
        "dedao",
        "kuaikandian",
        "lishipin",
        "qutoutiao",
        "dongfang_toutiao",
        "xueqiu",
        "eastmoney",
        "tonghuashun",
        "sina_finance",
        "other_media_platform",
      ],
    );
  });

  it("direct sources resolve without duplicate path", () => {
    for (const key of [
      "xiaohongshu",
      "douyin",
      "company_website",
      "referral",
      "agent_client",
      "inbound_inquiry",
    ]) {
      const path = resolveSourceMenuDisplayPath(key);
      assert.ok(path);
      assert.equal(path!.displayLabel, path!.leafLabel);
      assert.equal(path!.groupLabel, null);
    }
  });

  it("group leaves resolve as group / leaf", () => {
    const wechat = resolveSourceMenuDisplayPath("wechat_video_channel", "视频号");
    assert.equal(wechat?.displayLabel, "微信 / 视频号");

    const taobao = resolveSourceMenuDisplayPath("xianyu_taobao", "淘宝");
    assert.equal(taobao?.displayLabel, "其他平台 / 淘宝");

    const google = resolveSourceMenuDisplayPath("google", "Google");
    assert.equal(google?.displayLabel, "Overseas channels / Google");

    const twitter = resolveSourceMenuDisplayPath("x_twitter", "X（Twitter）");
    assert.equal(twitter?.displayLabel, "Overseas channels / X（Twitter）");
  });

  it("Overseas channels includes moved social platforms", () => {
    const overseasKeys = OVERSEAS_SOURCE_LEAVES.map((leaf) => leaf.tagKey);
    for (const key of [
      "x_twitter",
      "threads",
      "telegram",
      "snapchat",
      "dailymotion",
      "tumblr",
    ]) {
      assert.ok(overseasKeys.includes(key), `missing overseas key ${key}`);
    }
  });

  it("rejects group keys for writable validation", () => {
    const selectable = getConfiguredMenuLeafKeys();
    assert.equal(isMenuGroupKey("wechat"), true);
    assert.equal(isMenuGroupSourceKey("wechat"), true);
    assert.equal(assertWritableCustomerSourceKey("wechat", selectable), false);
    assert.equal(assertWritableCustomerSourceKey("xiaohongshu", selectable), true);
    assert.equal(assertWritableCustomerSourceKey("xianyu_taobao", selectable), true);
    assert.equal(assertWritableCustomerSourceKey("xianyu", selectable), true);
    assert.equal(assertWritableCustomerSourceKey("pinduoduo", selectable), true);
    assert.equal(assertWritableCustomerSourceKey("online_media", selectable), false);
    assert.equal(
      assertWritableCustomerSourceKey(PUBLIC_POOL_QUICK_ENTRY_SOURCE_KEY, selectable),
      false,
    );
    for (const key of RETIRED_FORMAL_SOURCE_KEYS) {
      assert.equal(
        assertWritableCustomerSourceKey(key, selectable),
        false,
        `retired key ${key} must not be writable`,
      );
    }
  });

  it("reports configured tag counts", () => {
    const stats = countMenuTagStats();
    assert.equal(stats.configuredLeafCount, 86);
    assert.equal(stats.reusedExistingTagCount, 6);
    assert.equal(stats.newTagCount, 80);
  });
});

describe("customer source resolver", () => {
  const labelMap = new Map<string, string>([
    ["xianyu_taobao", "淘宝"],
    ["referral", "客户转介绍"],
    ["agent_client", "代理渠道"],
    ["online_media", "其他媒体平台（历史未细分）"],
  ]);

  it("prefers DB label over legacy constants", () => {
    assert.equal(resolveCustomerSourceLabel("xianyu_taobao", labelMap), "淘宝");
    assert.equal(resolveCustomerSourceLabel("referral", labelMap), "客户转介绍");
  });

  it("resolves inactive legacy online_media from DB", () => {
    assert.equal(
      resolveCustomerSourceLabel("online_media", labelMap),
      "其他媒体平台（历史未细分）",
    );
  });

  it("falls back for public_pool_quick_entry without DB row", () => {
    assert.equal(
      resolveCustomerSourceLabel(PUBLIC_POOL_QUICK_ENTRY_SOURCE_KEY, labelMap),
      "公共池快速录入（历史）",
    );
  });
});

const BASE_INPUT = {
  customerName: "张三测试",
  customerType: "individual" as const,
  phoneCountryCode: "+86",
  phone: "13800138000",
  wechatId: "",
  email: "",
  source: "xiaohongshu",
  sourceRemark: "",
  requestedProjectCode: "hk_bank_account",
  requestedProjectName: "网站开发项目",
  notes: "客户当前处于初步沟通阶段，需要进一步跟进确认需求。",
  salesStage: "new_lead" as const,
};

describe("customer source validation", () => {
  const selectable = ["xiaohongshu", "douyin", "other"];

  it("accepts active menu leaf on create", () => {
    const errors = validateCustomerInput(BASE_INPUT, {
      requireSalesStage: true,
      allowedSourceKeys: selectable,
    });
    assert.equal(errors.length, 0);
  });

  it("rejects group key on create", () => {
    const errors = validateCustomerInput(
      { ...BASE_INPUT, source: "wechat" },
      { requireSalesStage: true, allowedSourceKeys: selectable },
    );
    assert.ok(errors.some((e) => e.field === "source"));
  });

  it("rejects inactive legacy on create", () => {
    const errors = validateCustomerInput(
      { ...BASE_INPUT, source: "online_media" },
      { requireSalesStage: true, allowedSourceKeys: selectable },
    );
    assert.ok(errors.some((e) => e.field === "source"));
  });

  it("allows legacy source unchanged on edit", () => {
    const errors = validateCustomerInput(
      { ...BASE_INPUT, source: "online_media" },
      {
        isUpdate: true,
        existingSourceKey: "online_media",
        allowedSourceKeys: selectable,
        userRole: "staff",
      },
    );
    assert.equal(errors.length, 0);
  });

  it("allows legacy customer to change to valid new source", () => {
    const errors = validateCustomerInput(
      { ...BASE_INPUT, source: "douyin" },
      {
        isUpdate: true,
        existingSourceKey: "online_media",
        allowedSourceKeys: selectable,
        userRole: "staff",
      },
    );
    assert.equal(errors.length, 0);
  });

  it("rejects legacy customer changing to invalid source", () => {
    const errors = validateCustomerInput(
      { ...BASE_INPUT, source: "online_media" },
      {
        isUpdate: true,
        existingSourceKey: "referral",
        allowedSourceKeys: selectable,
        userRole: "staff",
      },
    );
    assert.ok(errors.some((e) => e.field === "source"));
  });
});

describe("selectable source set (menu ∩ active DB)", () => {
  function tag(
    tagKey: string,
    overrides: Partial<CustomerTagListItem> = {},
  ): CustomerTagListItem {
    return {
      id: `id-${tagKey}`,
      tagKey,
      label: tagKey,
      isSystem: false,
      isActive: true,
      sortOrder: 1,
      ...overrides,
    };
  }

  it("Case A: menu leaf without DB row is not selectable", () => {
    const tags = [tag("xiaohongshu"), tag("referral")];
    const selectable = computeSelectableCustomerSourceKeys(tags);
    assert.equal(selectable.includes("youtube"), false);
    assert.equal(computeFormalMenuSelectableKeys(tags).includes("youtube"), false);
  });

  it("Case B: active DB row for menu leaf is selectable", () => {
    const tags = [tag("youtube", { label: "YouTube" })];
    const selectable = computeSelectableCustomerSourceKeys(tags);
    assert.ok(selectable.includes("youtube"));
  });

  it("Case C: inactive menu leaf is not selectable", () => {
    const tags = [tag("youtube", { isActive: false })];
    const selectable = computeSelectableCustomerSourceKeys(tags);
    assert.equal(selectable.includes("youtube"), false);
  });

  it("Case D: active custom tag outside menu is selectable", () => {
    const tags = [tag("vip_partner", { label: "VIP 合作" })];
    const selectable = computeSelectableCustomerSourceKeys(tags);
    assert.deepEqual(selectable, ["vip_partner"]);
    assert.deepEqual(computeEligibleCustomSelectableKeys(tags), ["vip_partner"]);
  });

  it("Case E: inactive custom tag is not selectable", () => {
    const tags = [tag("vip_partner", { isActive: false })];
    assert.deepEqual(computeSelectableCustomerSourceKeys(tags), []);
  });

  it("excludes legacy hidden and internal keys from custom selectable", () => {
    const tags = [
      tag("online_media", { isActive: false }),
      tag(PUBLIC_POOL_QUICK_ENTRY_SOURCE_KEY),
    ];
    assert.deepEqual(computeEligibleCustomSelectableKeys(tags), []);
  });

  it("excludes retired formal keys from custom selectable fallback", () => {
    for (const key of RETIRED_FORMAL_SOURCE_KEYS) {
      const tags = [tag(key, { label: key, isActive: true })];
      assert.deepEqual(
        computeEligibleCustomSelectableKeys(tags),
        [],
        `retired key ${key} must not appear as custom selectable`,
      );
      assert.equal(
        computeSelectableCustomerSourceKeys(tags).includes(key),
        false,
      );
    }
  });

  it("allows real admin custom tag while blocking retired formal tag", () => {
    const tags = [
      tag("weibo", { label: "微博", isActive: true }),
      tag("vip_partner", { label: "VIP 合作", isActive: true }),
    ];
    assert.deepEqual(computeEligibleCustomSelectableKeys(tags), ["vip_partner"]);
    assert.deepEqual(computeSelectableCustomerSourceKeys(tags), ["vip_partner"]);
  });
});

describe("approval on-hold source display", () => {
  it("xianyu_taobao resolves to 其他平台 / 淘宝 for approval detail", () => {
    const labelMap = new Map<string, string>([["xianyu_taobao", "淘宝"]]);
    assert.equal(
      resolveCustomerSourceDisplayLabel("xianyu_taobao", labelMap),
      "其他平台 / 淘宝",
    );
  });
});

describe("customer tag safety rules", () => {
  const tag = {
    id: "1",
    tagKey: "custom_channel",
    label: "自定义",
    isSystem: false,
    isActive: true,
    sortOrder: 1,
  };

  it("blocks delete when customers exist", () => {
    assert.throws(
      () => assertTagDeletable(tag, 3),
      /当前仍有 3 位历史客户/,
    );
  });

  it("allows delete when no customers", () => {
    assert.doesNotThrow(() => assertTagDeletable(tag, 0));
  });

  it("blocks system tag delete and deactivate", () => {
    const systemTag = { ...tag, tagKey: CUSTOMER_SOURCE_OTHER_KEY, isSystem: true };
    assert.throws(() => assertTagDeletable(systemTag, 0));
    assert.throws(() => assertTagDeactivatable(systemTag));
  });
});
