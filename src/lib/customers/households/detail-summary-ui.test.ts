import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

describe("customer detail family section UI", () => {
  it("renders family section after basic info with read-only controls", () => {
    const client = readFileSync(
      "src/app/(dashboard)/customers/[id]/customer-detail-client.tsx",
      "utf8",
    );
    const basicIdx = client.indexOf('t("customers.basicInfo")');
    const familyIdx = client.indexOf('t("customers.familyAndContacts")');
    const contactIdx = client.indexOf('t("customers.contactInfo")');
    assert.ok(basicIdx >= 0 && familyIdx > basicIdx && contactIdx > familyIdx);
    assert.match(client, /CustomerFamilyReadOnlySection/);
    assert.doesNotMatch(client, /新增家庭|Add Family|unlink|dissolve/i);
  });

  it("family readonly section uses restrained member rows", () => {
    const section = readFileSync(
      "src/components/customers/customer-family-readonly-section.tsx",
      "utf8",
    );
    assert.match(section, /familySelf/);
    assert.match(section, /ChevronRight/);
    assert.match(section, /familyProtectedMember/);
    assert.match(section, /truncate/);
    assert.doesNotMatch(section, /avatar|rounded-full bg-|animate-/i);
  });

  it("customer detail page loads family summary in secondary Promise.all", () => {
    const page = readFileSync(
      "src/app/(dashboard)/customers/[id]/page.tsx",
      "utf8",
    );
    assert.match(page, /getCustomerHouseholdDetailSummary/);
    assert.match(page, /familySummaryTimed/);
    assert.match(
      page,
      /Promise\.all\([\s\S]*getCustomerHouseholdDetailSummary/,
    );
  });
});

describe("B2 mobile family icon grouping follow-up", () => {
  it("groups icon and customer name in one inner flex container", () => {
    const client = readFileSync(
      "src/app/(dashboard)/customers/customers-list-client.tsx",
      "utf8",
    );
    assert.match(
      client,
      /inline-flex min-w-0 items-center gap-1\.5[\s\S]*CustomerFamilyIcon[\s\S]*CustomerNameLabel/,
    );
    assert.match(
      client,
      /CustomerNameLabel[\s\S]*PinnedBadge/,
    );
  });
});
