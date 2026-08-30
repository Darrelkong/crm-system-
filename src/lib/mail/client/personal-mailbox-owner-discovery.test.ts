import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import zhHant from "@/i18n/locales/zh-Hant";
import { translate } from "@/i18n/translate";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import {
  formatPersonalMailboxOwnerOptionLabel,
  listPersonalMailboxOwnerCandidates,
  shouldShowPersonalMailboxOwnerUnprovisionedHint,
} from "@/lib/mail/client/mailbox-management";
import {
  resolveComposeOutboundWorkflow,
  resolveComposeSubmitButtonLabelKey,
} from "@/lib/mail/client/compose-submission";
import { isEligiblePersonalMailboxOwner } from "@/lib/permissions/mail";
import { MAIL_COMPOSE_ATTACHMENT_LIMITS } from "@/lib/mail/compose-attachment-policy";

const activeUsers = [
  {
    id: "admin",
    name: "DarrellKoo",
    email: "darrell@example.com",
    role: "admin" as const,
    status: "active" as const,
  },
  {
    id: "staff-mail",
    name: "Daniel.Hayes",
    email: "daniel@example.com",
    role: "staff" as const,
    status: "active" as const,
  },
  {
    id: "staff-no-mail",
    name: "Member C",
    email: "memberc@example.com",
    role: "staff" as const,
    status: "active" as const,
  },
  {
    id: "disabled",
    name: "Disabled",
    email: "disabled@example.com",
    role: "staff" as const,
    status: "disabled" as const,
  },
  {
    id: "deleted",
    name: "Deleted",
    email: "deleted@example.com",
    role: "staff" as const,
    status: "deleted" as const,
  },
];

const accessItems = [
  {
    userId: "staff-mail",
    isEnabled: 1,
    enabledAt: "2026-08-26T10:43:31.470Z",
    disabledAt: null,
    createdAt: "2026-08-26T10:43:31.470Z",
    updatedAt: "2026-08-26T10:43:31.470Z",
    hasVerifiedNotificationIdentity: true,
  },
];

describe("personal mailbox owner discovery", () => {
  it("includes active root admin, mail-enabled staff, and unprovisioned staff", () => {
    const candidates = listPersonalMailboxOwnerCandidates(activeUsers, accessItems);
    assert.deepEqual(
      candidates.map((candidate) => candidate.id),
      ["staff-mail", "admin", "staff-no-mail"],
    );
  });

  it("excludes disabled and deleted CRM users", () => {
    const candidates = listPersonalMailboxOwnerCandidates(activeUsers, accessItems);
    assert.equal(candidates.some((candidate) => candidate.id === "disabled"), false);
    assert.equal(candidates.some((candidate) => candidate.id === "deleted"), false);
  });

  it("does not require mail_user_access for owner eligibility", () => {
    assert.equal(
      isEligiblePersonalMailboxOwner({ userStatus: "active" }),
      true,
    );
    const unprovisioned = listPersonalMailboxOwnerCandidates(activeUsers, accessItems).find(
      (candidate) => candidate.id === "staff-no-mail",
    );
    assert.ok(unprovisioned);
    assert.equal(unprovisioned?.mailAccessEnabled, false);
  });

  it("shows Mail status in picker labels and helper for unprovisioned owners", () => {
    const candidates = listPersonalMailboxOwnerCandidates(activeUsers, accessItems);
    const unprovisioned = candidates.find((candidate) => candidate.id === "staff-no-mail");
    assert.equal(
      formatPersonalMailboxOwnerOptionLabel(unprovisioned!, {
        mailAccessEnabled: translate(
          zhHant,
          "mail.adminCenter.mailbox.ownerMailAccessEnabled",
        ),
        mailAccessDisabled: translate(
          zhHant,
          "mail.adminCenter.mailbox.ownerMailAccessDisabled",
        ),
      }),
      "Member C · Mail 未開通",
    );
    assert.equal(
      shouldShowPersonalMailboxOwnerUnprovisionedHint(unprovisioned),
      true,
    );
    assert.match(
      translate(zhHant, "mail.adminCenter.mailbox.ownerUnprovisionedHint"),
      /建立郵箱不會自動開通其 Mail 權限/,
    );
  });

  it("preserves compose workflow separation for root and staff", () => {
    assert.equal(resolveComposeOutboundWorkflow(true), "admin_direct");
    assert.equal(resolveComposeOutboundWorkflow(false), "staff_approved");
    assert.equal(
      resolveComposeSubmitButtonLabelKey({
        submitting: false,
        workflow: "admin_direct",
        approvalReturned: false,
      }),
      "mail.compose.send",
    );
    assert.equal(
      translate(
        zhHant,
        resolveComposeSubmitButtonLabelKey({
          submitting: false,
          workflow: "staff_approved",
          approvalReturned: false,
        }),
      ),
      "提交審核",
    );
  });

  it("does not implement mailbox creation side effects in owner picker module", () => {
    const mailboxService = readFileSync("src/lib/mail/mailbox-service.ts", "utf8");
    assert.doesNotMatch(mailboxService, /insert\(schema\.mailUserAccess\)/);
    assert.doesNotMatch(mailboxService, /insert\(schema\.mailSenderIdentities\)/);
    assert.doesNotMatch(mailboxService, /insert\(schema\.mailSenderIdentityGrants\)/);
  });

  it("preserves existing personal mailbox cardinality (address uniqueness only)", () => {
    const source = readFileSync("src/lib/mail/client/mailbox-management.ts", "utf8");
    assert.doesNotMatch(source, /already owns a personal mailbox/i);
    assert.doesNotMatch(source, /one personal mailbox per user/i);
  });

  it("documents local seed CRM team inventory baseline", () => {
    const seedUserIds = [SEED_IDS.admin, SEED_IDS.staffA, SEED_IDS.staffB];
    assert.equal(seedUserIds.length, 3);
    assert.equal(
      MAIL_COMPOSE_ATTACHMENT_LIMITS.maxAttachmentCount,
      10,
      "unrelated Phase 2 policy must remain unchanged",
    );
  });
});
