import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

describe("dashboard page header", () => {
  it("uses shared greeting header and Knowledge AI entry on admin and staff dashboards", () => {
    const adminPage = readFileSync("src/app/(dashboard)/admin/page.tsx", "utf8");
    const staffPage = readFileSync("src/app/(dashboard)/staff/page.tsx", "utf8");
    const actions = readFileSync(
      "src/components/dashboard/dashboard-header-actions.tsx",
      "utf8",
    );
    const header = readFileSync(
      "src/components/dashboard/dashboard-page-header.tsx",
      "utf8",
    );

    for (const source of [adminPage, staffPage]) {
      assert.match(source, /DashboardPageHeader/);
      assert.match(source, /displayName=\{user\.displayName\}/);
      assert.doesNotMatch(source, /TranslatedPageHeader/);
    }

    assert.match(adminPage, /layout\.adminControlCenter/);
    assert.match(adminPage, /nameEmphasis="admin"/);
    assert.match(staffPage, /brand\.dashboardSubtitle/);
    assert.match(actions, /href="\/customers\/new"/);
    assert.match(actions, /href="\/knowledge"/);
    assert.match(actions, /Knowledge AI/);
    assert.doesNotMatch(actions, /grid-cols-2/);
    assert.match(header, /DashboardHeaderActions/);
    assert.doesNotMatch(header, /justify-end/);
    assert.doesNotMatch(actions, /justify-end/);
    assert.doesNotMatch(actions, /knowledge_admin|knowledgeAdmin|role ===/i);
  });

  it("renders greeting hello separately from the display name", () => {
    const header = readFileSync(
      "src/components/dashboard/dashboard-page-header.tsx",
      "utf8",
    );

    assert.match(header, /layout\.greetingHello/);
    assert.match(header, /\{displayName\}/);
    assert.doesNotMatch(header, /layout\.greeting"/);
    assert.doesNotMatch(header, /titleParams/);
  });

  it("keeps hero actions aligned with the greeting content column", () => {
    const header = readFileSync(
      "src/components/dashboard/dashboard-page-header.tsx",
      "utf8",
    );

    assert.match(header, /getAdminDisplayNameClass/);
    assert.match(header, /mt-6 sm:mt-7/);
    assert.doesNotMatch(header, /sm:flex-row/);
    assert.doesNotMatch(header, /sm:justify-between/);
  });
});
