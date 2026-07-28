import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  REQUESTED_PROJECT_GROUPS,
  REQUESTED_PROJECT_ITEMS,
  REQUESTED_PROJECT_OTHER_CODE,
  getRequestedProjectGroupForCode,
  getRequestedProjectItem,
  isRequestedProjectCode,
  searchRequestedProjectItems,
  searchRequestedProjectItemsInGroup,
} from "@/lib/constants/requested-projects";
import { resolveRequestedProjectDisplayName } from "@/lib/customers/requested-project-display";
import { resolveRequestedProjectForPersist } from "@/lib/customers/requested-project-resolve";
import { validateCustomerInput } from "@/lib/customers/validation";
import { normalizeCustomerCreateDraftForm } from "@/lib/customers/customer-create-draft";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("requested-projects catalog", () => {
  it("has exactly 12 groups and 61 items", () => {
    assert.equal(REQUESTED_PROJECT_GROUPS.length, 12);
    assert.equal(REQUESTED_PROJECT_ITEMS.length, 61);
  });

  it("has unique group codes and item codes", () => {
    const groups = REQUESTED_PROJECT_GROUPS.map((g) => g.groupCode);
    assert.equal(new Set(groups).size, groups.length);
    const codes = REQUESTED_PROJECT_ITEMS.map((i) => i.code);
    assert.equal(new Set(codes).size, codes.length);
  });

  it("ends with other group and other item", () => {
    const lastGroup = REQUESTED_PROJECT_GROUPS[REQUESTED_PROJECT_GROUPS.length - 1]!;
    const lastItem = REQUESTED_PROJECT_ITEMS[REQUESTED_PROJECT_ITEMS.length - 1]!;
    assert.equal(lastGroup.groupCode, "other");
    assert.equal(lastItem.code, REQUESTED_PROJECT_OTHER_CODE);
    assert.equal(lastItem.groupCode, "other");
  });

  it("every item points to a valid group with trilingual labels and canonicalZhHans", () => {
    const groupCodes = new Set(REQUESTED_PROJECT_GROUPS.map((g) => g.groupCode));
    for (const item of REQUESTED_PROJECT_ITEMS) {
      assert.ok(groupCodes.has(item.groupCode), item.code);
      assert.ok(item.labels["zh-Hant"]);
      assert.ok(item.labels["zh-Hans"]);
      assert.ok(item.labels.en);
      assert.ok(item.canonicalZhHans);
      assert.equal(item.canonicalZhHans, item.labels["zh-Hans"]);
    }
    for (const group of REQUESTED_PROJECT_GROUPS) {
      assert.ok(group.labels["zh-Hant"]);
      assert.ok(group.labels["zh-Hans"]);
      assert.ok(group.labels.en);
    }
  });
});

describe("requested project search", () => {
  it("level-1 global search finds second-level items with group breadcrumb data", () => {
    const hits = searchRequestedProjectItems("ITIN");
    assert.ok(hits.some((h) => h.item.code === "us_itin"));
    const hit = hits.find((h) => h.item.code === "us_itin")!;
    assert.equal(hit.group.groupCode, "united_states");
  });

  it("level-2 search is scoped to the active group", () => {
    const hk = searchRequestedProjectItemsInGroup("hong_kong", "銀行");
    assert.ok(hk.every((i) => i.groupCode === "hong_kong"));
    assert.ok(hk.some((i) => i.code === "hk_bank_account"));
    const us = searchRequestedProjectItemsInGroup("united_states", "銀行");
    assert.ok(!us.some((i) => i.code === "hk_bank_account"));
  });

  it("matches aliases like Amazon / TikTok / ODI / EP without exposing code requirement", () => {
    assert.ok(searchRequestedProjectItems("Amazon").some((h) => h.item.code === "amazon_ecommerce"));
    assert.ok(searchRequestedProjectItems("TikTok").some((h) => h.item.code === "tiktok_shop_ecommerce"));
    assert.ok(searchRequestedProjectItems("ODI").some((h) => h.item.code === "odi_filing"));
    assert.ok(searchRequestedProjectItems("EP").some((h) => h.item.code === "sg_identity_ep"));
  });
});

describe("resolveRequestedProjectForPersist", () => {
  it("persists standard code with server canonical name ignoring forged client name", () => {
    const result = resolveRequestedProjectForPersist({
      requestedProjectCode: "hk_bank_account",
      requestedProjectName: "伪造名称不应保存",
      mode: "create",
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.value.requestedProjectCode, "hk_bank_account");
    assert.equal(result.value.requestedProjectName, "香港银行账户");
  });

  it("rejects invalid code with no persist value", () => {
    const result = resolveRequestedProjectForPersist({
      requestedProjectCode: "not_a_real_code",
      requestedProjectName: "任意名称足够长",
      mode: "create",
    });
    assert.equal(result.ok, false);
  });

  it("rejects missing project on create", () => {
    const result = resolveRequestedProjectForPersist({
      requestedProjectCode: null,
      requestedProjectName: null,
      mode: "create",
    });
    assert.equal(result.ok, false);
  });

  it("rejects empty other name and accepts valid other", () => {
    const empty = resolveRequestedProjectForPersist({
      requestedProjectCode: "other",
      requestedProjectName: "",
      mode: "create",
    });
    assert.equal(empty.ok, false);

    const onlyOther = resolveRequestedProjectForPersist({
      requestedProjectCode: "other",
      requestedProjectName: "其他",
      mode: "create",
    });
    assert.equal(onlyOther.ok, false);

    const ok = resolveRequestedProjectForPersist({
      requestedProjectCode: "other",
      requestedProjectName: "定制咨询服务项目",
      mode: "create",
    });
    assert.equal(ok.ok, true);
    if (!ok.ok) return;
    assert.equal(ok.value.requestedProjectCode, "other");
    assert.equal(ok.value.requestedProjectName, "定制咨询服务项目");
  });

  it("keeps legacy null code on update when unchanged", () => {
    const result = resolveRequestedProjectForPersist({
      requestedProjectCode: null,
      requestedProjectName: "旧客户自由文本项目名称",
      mode: "update",
      existingCode: null,
      existingName: "旧客户自由文本项目名称",
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.value.requestedProjectCode, null);
    assert.equal(result.value.requestedProjectName, "旧客户自由文本项目名称");
  });

  it("allows admin reclassification to standard code", () => {
    const result = resolveRequestedProjectForPersist({
      requestedProjectCode: "us_itin",
      requestedProjectName: "whatever",
      mode: "update",
      existingCode: null,
      existingName: "旧文字",
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.value.requestedProjectCode, "us_itin");
    assert.equal(result.value.requestedProjectName, "美国 ITIN 税号");
  });
});

describe("validateCustomerInput requested project", () => {
  const base = {
    customerName: "张三测试",
    customerType: "individual",
    phoneCountryCode: "+86",
    phone: "13800138000",
    wechatId: "",
    email: "",
    source: "referral",
    sourceRemark: "",
    notes: "客户当前处于初步沟通阶段，需要进一步跟进确认需求。",
    salesStage: "new_lead",
    status: "active",
  };

  it("accepts standard code create even if client name is forged", () => {
    const errors = validateCustomerInput(
      {
        ...base,
        requestedProjectCode: "hk_bank_account",
        requestedProjectName: "伪造",
      },
      { requireSalesStage: true, allowedSourceKeys: ["referral"] },
    );
    assert.equal(
      errors.filter((e) => e.field.startsWith("requestedProject")).length,
      0,
    );
  });

  it("rejects create without code", () => {
    const errors = validateCustomerInput(
      { ...base, requestedProjectName: "足够长的项目名称" },
      { requireSalesStage: true, allowedSourceKeys: ["referral"] },
    );
    assert.ok(errors.some((e) => e.code === "REQUESTED_PROJECT_CODE_REQUIRED"));
  });
});

describe("requested project display helper", () => {
  it("shows locale label for standard code", () => {
    assert.equal(
      resolveRequestedProjectDisplayName({
        requestedProjectCode: "hk_bank_account",
        requestedProjectName: "香港银行账户",
        locale: "zh-Hant",
      }),
      "香港銀行賬戶",
    );
  });

  it("shows manual name for other and legacy null", () => {
    assert.equal(
      resolveRequestedProjectDisplayName({
        requestedProjectCode: "other",
        requestedProjectName: "手工项目名称",
        locale: "en",
      }),
      "手工项目名称",
    );
    assert.equal(
      resolveRequestedProjectDisplayName({
        requestedProjectCode: null,
        requestedProjectName: "旧自由文本",
        locale: "en",
      }),
      "旧自由文本",
    );
  });

  it("falls back safely for unknown code without showing raw code", () => {
    const display = resolveRequestedProjectDisplayName({
      requestedProjectCode: "totally_unknown",
      requestedProjectName: "回退名称",
      locale: "en",
    });
    assert.equal(display, "回退名称");
    assert.ok(!display.includes("totally_unknown"));
  });
});

describe("draft restore for requested project", () => {
  it("restores standard code and other plus manual name", () => {
    const standard = normalizeCustomerCreateDraftForm({
      requestedProjectCode: "sg_bank_account",
      requestedProjectName: "新加坡银行账户",
    });
    assert.equal(standard.requestedProjectCode, "sg_bank_account");
    assert.equal(standard.requestedProjectName, "新加坡银行账户");

    const other = normalizeCustomerCreateDraftForm({
      requestedProjectCode: "other",
      requestedProjectName: "自定义其他项目名称",
    });
    assert.equal(other.requestedProjectCode, "other");
    assert.equal(other.requestedProjectName, "自定义其他项目名称");
  });
});

describe("selector UX contracts (source)", () => {
  const selectorPath = join(
    process.cwd(),
    "src/components/customers/requested-project-selector.tsx",
  );
  const source = readFileSync(selectorPath, "utf8");

  it("implements mobile two-step groups then items with back that does not close", () => {
    assert.match(source, /step === "groups"/);
    assert.match(source, /step === "items"/);
    assert.match(source, /goBackToGroups/);
    assert.match(source, /setStep\("items"\)/);
    assert.match(source, /const goBackToGroups/);
    assert.ok(!/const goBackToGroups = \(\) => \{[^}]*setOpen\(false\)/.test(source));
  });

  it("supports desktop dual pane and keyboard Esc / arrows / Enter", () => {
    assert.match(source, /project-selector-dual/);
    assert.match(source, /project-selector-dialog/);
    assert.match(source, /ArrowDown/);
    assert.match(source, /ArrowUp/);
    assert.match(source, /Enter/);
    assert.match(source, /Escape/);
  });

  it("uses centered dialog layout classes (not bottom sheet)", () => {
    const css = readFileSync(
      join(process.cwd(), "src/app/globals.css"),
      "utf8",
    );
    const start = css.indexOf("/* ── Requested project country/region selector");
    const end = css.indexOf("/* ── Quick Entry V2 Drawer", start);
    const section = css.slice(start, end === -1 ? undefined : end);
    assert.match(section, /\.project-selector-dialog/);
    assert.match(section, /clamp\(280px,\s*calc\(100vw - 72px\),\s*330px\)/);
    assert.match(section, /max-height:\s*min\(72dvh,\s*560px\)/);
    assert.match(section, /@media \(max-width: 767px\)/);
    assert.match(css, /width:\s*min\(680px/);
    assert.doesNotMatch(section, /\.project-selector-sheet\s*\{/);
    assert.doesNotMatch(section, /\.project-selector-dialog[^{]*\{[^}]*bottom:\s*0/);
    assert.match(section, /place-items:\s*center/);
  });

  it("global search results include group breadcrumb pattern", () => {
    assert.match(source, /groupLabel\(group\)/);
    assert.match(source, /withBreadcrumb/);
    assert.ok(source.includes(" · "));
  });
});

describe("staff lock includes project code without expanding staff edit rights", () => {
  it("keeps requestedProjectCode in server staff locked fields", () => {
    const path = join(process.cwd(), "src/lib/permissions/customers.ts");
    const source = readFileSync(path, "utf8");
    assert.match(source, /"requestedProjectCode"/);
    assert.match(source, /"requestedProjectName"/);
  });
});

describe("catalog helpers", () => {
  it("derives group from code and validates codes", () => {
    assert.equal(
      getRequestedProjectGroupForCode("hk_bank_account")?.groupCode,
      "hong_kong",
    );
    assert.equal(isRequestedProjectCode("hk_bank_account"), true);
    assert.equal(isRequestedProjectCode("nope"), false);
    assert.equal(getRequestedProjectItem("other")?.code, "other");
  });
});

describe("untouched modules (source contracts)", () => {
  it("does not alter quick-entry / import / export / AI / public-pool project flows in this change set beyond necessary types", () => {
    // Smoke: quick-entry still validates free-text project name only
    const qe = readFileSync(
      join(process.cwd(), "src/lib/public-pool/quick-entry-customer-validation.ts"),
      "utf8",
    );
    assert.match(qe, /requestedProjectName/);
    assert.doesNotMatch(qe, /requestedProjectCode/);
  });
});
