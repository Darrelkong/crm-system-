import assert from "node:assert/strict";
import { describe, it } from "node:test";
import zhHant from "@/i18n/locales/zh-Hant";
import {
  HELP_CONTENT_SECTIONS,
  HELP_FAQ_ITEMS,
  getHelpFaqForRole,
  getHelpSectionsForRole,
} from "./sections";

function sectionIds(role: "admin" | "staff"): string[] {
  return getHelpSectionsForRole(role).map((section) => section.id);
}

function faqIds(role: "admin" | "staff"): string[] {
  return getHelpFaqForRole(role).map((item) => item.id);
}

function assertExcludes(ids: string[], excluded: string[]) {
  for (const id of excluded) {
    assert.equal(
      ids.includes(id),
      false,
      `expected ids not to include ${id}`,
    );
  }
}

function assertIncludes(ids: string[], required: string[]) {
  for (const id of required) {
    assert.equal(
      ids.includes(id),
      true,
      `expected ids to include ${id}`,
    );
  }
}

describe("help page title", () => {
  it("keeps help.title as 幫助中心", () => {
    assert.equal(zhHant.help.title, "幫助中心");
  });

  it("does not use 員工使用指南 as page title", () => {
    assert.notEqual(zhHant.help.title, "員工使用指南");
    assert.equal(
      JSON.stringify(zhHant.help).includes("員工使用指南"),
      false,
      "help copy should not use 員工使用指南 as page title",
    );
  });
});

describe("getHelpSectionsForRole staff", () => {
  const staffSectionIds = sectionIds("staff");

  it("includes employee-focused sections", () => {
    assertIncludes(staffSectionIds, [
      "aiCustomerAnalysis",
      "addCustomer",
      "recordFollowUp",
      "avoidPublicPool",
      "claimFromPool",
      "announcements",
      "approvals",
    ]);
  });

  it("excludes legacy admin-only sections", () => {
    assertExcludes(staffSectionIds, [
      "adminGuide",
      "adminWorkspace",
      "employeeMgmt",
      "autoReclaimSettings",
      "recycleBinAdmin",
    ]);
  });
});

describe("getHelpSectionsForRole admin", () => {
  const adminSectionIds = sectionIds("admin");

  it("includes the same employee-focused sections", () => {
    assertIncludes(adminSectionIds, [
      "aiCustomerAnalysis",
      "addCustomer",
      "recordFollowUp",
      "avoidPublicPool",
      "claimFromPool",
      "announcements",
      "approvals",
    ]);
  });

  it("excludes legacy admin-only backend sections", () => {
    assertExcludes(adminSectionIds, [
      "adminGuide",
      "adminWorkspace",
      "employeeMgmt",
      "autoReclaimSettings",
    ]);
  });
});

describe("AI customer analysis section", () => {
  it("includes aiCustomerAnalysis with testingPhase badge flag", () => {
    const section = HELP_CONTENT_SECTIONS.find(
      (item) => item.id === "aiCustomerAnalysis",
    );
    assert.ok(section);
    assert.equal(section?.testingPhase, true);
  });

  it("includes testing phase badge copy in zh-Hant", () => {
    assert.equal(zhHant.help.testingPhaseBadge, "測試階段");
  });
});

describe("getHelpFaqForRole", () => {
  it("includes employee FAQ items for staff", () => {
    assertIncludes(faqIds("staff"), [
      "cannotSeeCustomer",
      "customerInPublicPool",
      "aiAnalysisIncomplete",
      "whyRecordFollowUp",
      "welcomePageFirst",
    ]);
  });

  it("includes employee FAQ items for admin", () => {
    assertIncludes(faqIds("admin"), [
      "cannotSeeCustomer",
      "customerInPublicPool",
      "aiAnalysisIncomplete",
      "whyRecordFollowUp",
      "welcomePageFirst",
    ]);
  });

  it("does not include roleDifference FAQ", () => {
    assertExcludes(faqIds("staff"), ["roleDifference"]);
    assertExcludes(faqIds("admin"), ["roleDifference"]);
  });
});

describe("help content ids", () => {
  it("has unique section ids in HELP_CONTENT_SECTIONS", () => {
    const ids = HELP_CONTENT_SECTIONS.map((section) => section.id);
    assert.equal(ids.length, new Set(ids).size);
  });

  it("has unique FAQ ids in HELP_FAQ_ITEMS", () => {
    const ids = HELP_FAQ_ITEMS.map((item) => item.id);
    assert.equal(ids.length, new Set(ids).size);
  });
});
