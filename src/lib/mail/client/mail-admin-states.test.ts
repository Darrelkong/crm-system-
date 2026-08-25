import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const ADMIN_SECTIONS = [
  "src/components/mail/admin/mail-admin-overview.tsx",
  "src/components/mail/admin/mail-admin-overview-notification-identity-card.tsx",
  "src/components/mail/admin/mail-access-management.tsx",
  "src/components/mail/admin/notification-identity-management.tsx",
  "src/components/mail/admin/sender-identity-management.tsx",
  "src/components/mail/admin/mailbox-management.tsx",
  "src/components/mail/admin/proof-diagnostics.tsx",
] as const;

describe("mail admin shared states", () => {
  it("exports loading, error, and empty state components", () => {
    const source = readFileSync(
      "src/components/mail/admin/mail-admin-states.tsx",
      "utf8",
    );
    assert.match(source, /export function MailAdminLoadingState/);
    assert.match(source, /export function MailAdminErrorState/);
    assert.match(source, /export function MailAdminEmptyState/);
    assert.match(source, /mail\.adminCenter\.retry/);
  });
});

describe("mail admin section state wiring", () => {
  for (const sectionPath of ADMIN_SECTIONS) {
    it(`uses shared admin states in ${sectionPath}`, () => {
      const source = readFileSync(sectionPath, "utf8");
      assert.match(source, /MailAdmin(Loading|Error|Empty)State/);
    });
  }
});

describe("mail admin center mobile layout", () => {
  it("keeps drawer content constrained for narrow viewports", () => {
    const source = readFileSync(
      "src/components/mail/admin/mail-admin-center-drawer.tsx",
      "utf8",
    );
    assert.match(source, /min-w-0/);
    assert.match(source, /overflow-x-hidden/);
  });
});
