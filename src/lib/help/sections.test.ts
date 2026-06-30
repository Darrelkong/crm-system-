import assert from "node:assert/strict";
import { describe, it } from "node:test";
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

describe("getHelpSectionsForRole staff", () => {
  const staffSectionIds = sectionIds("staff");

  it("excludes admin-only sections", () => {
    assertExcludes(staffSectionIds, [
      "adminGuide",
      "employeeMgmt",
      "autoReclaimSettings",
      "adminSensitiveAssignees",
      "recycleBinAdmin",
    ]);
  });

  it("includes staff guide and deep-dive sections", () => {
    assertIncludes(staffSectionIds, [
      "staffGuide",
      "sensitiveDataStaff",
      "publicPoolStaff",
      "collaboratorsStaff",
      "followUpRules",
      "loginSecurity",
    ]);
  });
});

describe("getHelpSectionsForRole admin", () => {
  const adminSectionIds = sectionIds("admin");

  it("includes admin-only sections", () => {
    assertIncludes(adminSectionIds, [
      "adminGuide",
      "employeeMgmt",
      "autoReclaimSettings",
      "adminSensitiveAssignees",
      "recycleBinAdmin",
    ]);
  });

  it("excludes staff-only deep sections", () => {
    assertExcludes(adminSectionIds, [
      "sensitiveDataStaff",
      "publicPoolStaff",
      "collaboratorsStaff",
    ]);
  });
});

describe("getHelpSectionsForRole shared sections", () => {
  it("shows all-audience sections to both admin and staff", () => {
    const shared = ["followUpRules", "customerFlow", "recycleBin", "loginSecurity"];

    assertIncludes(sectionIds("admin"), shared);
    assertIncludes(sectionIds("staff"), shared);
  });
});

describe("getHelpFaqForRole staff", () => {
  const staffFaqIds = faqIds("staff");

  it("excludes admin-only FAQ items", () => {
    assertExcludes(staffFaqIds, [
      "permanentDelete",
      "autoReclaim",
      "assigneeApproval",
      "deletedCustomer",
      "deletedEmployeeCustomers",
    ]);
  });

  it("includes staff FAQ items", () => {
    assertIncludes(staffFaqIds, [
      "createConfirmWait",
      "sensitiveLocked",
      "publicPoolNameMask",
      "cannotClaimPool",
    ]);
  });
});

describe("getHelpFaqForRole admin", () => {
  const adminFaqIds = faqIds("admin");

  it("includes admin FAQ items", () => {
    assertIncludes(adminFaqIds, [
      "permanentDelete",
      "autoReclaim",
      "assigneeApproval",
    ]);
  });

  it("excludes staff-only FAQ items", () => {
    assertExcludes(adminFaqIds, [
      "createConfirmWait",
      "sensitiveLocked",
      "publicPoolNameMask",
      "cannotClaimPool",
    ]);
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
