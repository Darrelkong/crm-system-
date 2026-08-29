import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import type { MailboxApiItem } from "@/lib/mail/client/mailbox-management";
import type { MailboxMemberApiItem } from "@/lib/mail/client/shared-mailbox-management";
import type { SenderIdentityApiItem } from "@/lib/mail/client/sender-identity-management";
import {
  actorHasEligibleSendMailbox,
  buildSenderIdentityGrantRows,
  countActiveSenderIdentityGrants,
  filterGrantPickerUsers,
  isSelfGrantSubmitEnabled,
  listActorEligibleSendMailboxes,
  mapGrantUserOptions,
  resolveComposeMailboxId,
  resolveCreateFormMailboxView,
  resolveCreateIdentitySelfGrantBlockedReason,
  resolveSenderIdentityGrantEligibility,
  senderIdentityGrantRevokePath,
  senderIdentityGrantsPath,
  userHasMailboxSendAuthorization,
} from "@/lib/mail/client/sender-identity-grant-management";

const ADMIN_ID = "11111111-1111-1111-1111-111111111101";
const DANIEL_ID = "a730a839-2f15-4521-83be-4543af8f7985";
const MAILBOX_ID = "267c4e95-230b-416b-a104-314bb6ca2889";

function mailbox(
  overrides: Partial<MailboxApiItem> = {},
): MailboxApiItem {
  return {
    id: MAILBOX_ID,
    address: "daniel.hayes@echfronthk.com",
    displayName: "Daniel.Hayes",
    mailboxType: "personal",
    status: "active",
    createdBy: DANIEL_ID,
    createdAt: "2026-08-26T10:00:00.000Z",
    updatedAt: "2026-08-26T10:00:00.000Z",
    ...overrides,
  };
}

function identity(
  overrides: Partial<SenderIdentityApiItem> = {},
): SenderIdentityApiItem {
  return {
    id: "identity-1",
    address: "daniel.hayes@echfronthk.com",
    displayName: "Daniel.Hayes",
    status: "active",
    defaultMailboxId: MAILBOX_ID,
    sentFolderMailboxId: null,
    aliasOfIdentityId: null,
    createdBy: ADMIN_ID,
    createdAt: "2026-08-26T10:00:00.000Z",
    updatedAt: "2026-08-26T10:00:00.000Z",
    ...overrides,
  };
}

function member(
  overrides: Partial<MailboxMemberApiItem> = {},
): MailboxMemberApiItem {
  return {
    id: "member-1",
    mailboxId: MAILBOX_ID,
    userId: DANIEL_ID,
    canRead: true,
    canReply: true,
    canSend: true,
    canAssign: false,
    canManageProcessing: false,
    canAddInternalNote: false,
    grantedBy: ADMIN_ID,
    revokedAt: null,
    revokedBy: null,
    createdAt: "2026-08-26T10:00:00.000Z",
    updatedAt: "2026-08-26T10:00:00.000Z",
    ...overrides,
  };
}

describe("sender identity grant management helpers", () => {
  it("builds grant API paths without raw UUID paste in UI", () => {
    assert.equal(
      senderIdentityGrantsPath("identity-1"),
      "/api/mail/sender-identities/identity-1/grants",
    );
    assert.equal(
      senderIdentityGrantRevokePath("grant-1"),
      "/api/mail/sender-identity-grants/grant-1/revoke",
    );
  });

  it("counts active grants only", () => {
    assert.equal(
      countActiveSenderIdentityGrants([
        {
          id: "g1",
          senderIdentityId: "identity-1",
          userId: DANIEL_ID,
          canReply: false,
          canSend: true,
          grantedBy: ADMIN_ID,
          revokedAt: null,
          revokedBy: null,
          createdAt: "",
          updatedAt: "",
        },
        {
          id: "g2",
          senderIdentityId: "identity-1",
          userId: ADMIN_ID,
          canReply: false,
          canSend: true,
          grantedBy: ADMIN_ID,
          revokedAt: "2026-08-29T00:00:00.000Z",
          revokedBy: ADMIN_ID,
          createdAt: "",
          updatedAt: "",
        },
      ]),
      1,
    );
  });

  it("maps CRM users for grant picker with role", () => {
    const users = mapGrantUserOptions([
      {
        id: ADMIN_ID,
        name: "DarrellKoo",
        email: "admin@example.com",
        role: "admin",
        status: "active",
      },
      {
        id: DANIEL_ID,
        name: "Daniel.Hayes",
        email: "daniel.hayes@echfronthk.com",
        role: "staff",
        status: "active",
      },
    ]);
    assert.equal(users.length, 2);
    assert.ok(users.some((user) => user.id === ADMIN_ID && user.role === "admin"));
  });

  it("authorizes personal mailbox owner for send", () => {
    assert.equal(
      userHasMailboxSendAuthorization(DANIEL_ID, mailbox(), []),
      true,
    );
  });

  it("does not treat admin global_read supervision as mailbox send authorization", () => {
    assert.equal(
      userHasMailboxSendAuthorization(ADMIN_ID, mailbox(), []),
      false,
    );
  });

  it("authorizes shared mailbox member with canSend", () => {
    const shared = mailbox({
      id: "shared-1",
      mailboxType: "shared",
      createdBy: ADMIN_ID,
    });
    assert.equal(
      userHasMailboxSendAuthorization(
        ADMIN_ID,
        shared,
        [member({ mailboxId: "shared-1", userId: ADMIN_ID })],
      ),
      true,
    );
  });

  it("blocks canSend grant eligibility for admin on Daniel personal mailbox", () => {
    const eligibility = resolveSenderIdentityGrantEligibility(
      ADMIN_ID,
      mailbox(),
      [],
    );
    assert.equal(eligibility.mailboxSendAuthorized, false);
    assert.equal(eligibility.canGrantCanSend, false);
  });

  it("allows Daniel canSend grant on Daniel personal mailbox identity", () => {
    const eligibility = resolveSenderIdentityGrantEligibility(
      DANIEL_ID,
      mailbox(),
      [],
    );
    assert.equal(eligibility.canGrantCanSend, true);
  });

  it("builds grant rows with mailbox send status", () => {
    const rows = buildSenderIdentityGrantRows(
      [
        {
          id: "grant-1",
          senderIdentityId: "identity-1",
          userId: DANIEL_ID,
          canReply: false,
          canSend: true,
          grantedBy: ADMIN_ID,
          revokedAt: null,
          revokedBy: null,
          createdAt: "",
          updatedAt: "",
        },
      ],
      mapGrantUserOptions([
        {
          id: DANIEL_ID,
          name: "Daniel.Hayes",
          email: "daniel.hayes@echfronthk.com",
          role: "staff",
          status: "active",
        },
      ]),
      mailbox(),
      [],
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.mailboxSendAuthorized, true);
  });

  it("filters picker users to exclude already-granted users", () => {
    const users = mapGrantUserOptions([
      {
        id: ADMIN_ID,
        name: "DarrellKoo",
        email: "admin@example.com",
        role: "admin",
        status: "active",
      },
      {
        id: DANIEL_ID,
        name: "Daniel.Hayes",
        email: "daniel.hayes@echfronthk.com",
        role: "staff",
        status: "active",
      },
    ]);
    const filtered = filterGrantPickerUsers(
      users,
      [
        {
          id: "grant-1",
          senderIdentityId: "identity-1",
          userId: DANIEL_ID,
          canReply: false,
          canSend: true,
          grantedBy: ADMIN_ID,
          revokedAt: null,
          revokedBy: null,
          createdAt: "",
          updatedAt: "",
        },
      ],
      "",
    );
    assert.deepEqual(
      filtered.map((user) => user.id),
      [ADMIN_ID],
    );
  });

  it("defaults self-grant checkbox off and blocks ineligible mailbox self-grant", () => {
    assert.equal(
      isSelfGrantSubmitEnabled({
        grantSelfOnCreate: false,
        defaultMailboxId: MAILBOX_ID,
        selfUserId: ADMIN_ID,
        mailbox: mailbox(),
        members: [],
      }),
      true,
    );
    assert.equal(
      isSelfGrantSubmitEnabled({
        grantSelfOnCreate: true,
        defaultMailboxId: MAILBOX_ID,
        selfUserId: ADMIN_ID,
        mailbox: mailbox(),
        members: [],
      }),
      false,
    );
    assert.equal(
      resolveCreateIdentitySelfGrantBlockedReason({
        grantSelfOnCreate: true,
        selfUserId: ADMIN_ID,
        mailbox: mailbox(),
        members: [],
      }),
      "missingMailboxSendAuthorization",
    );
  });

  it("allows Darrell personal mailbox owner self-grant", () => {
    const darrellMailbox = mailbox({
      id: "darrell-mailbox",
      address: "darrellkoo@echfronthk.com",
      displayName: "DarrellKoo",
      createdBy: ADMIN_ID,
    });
    assert.equal(
      isSelfGrantSubmitEnabled({
        grantSelfOnCreate: true,
        defaultMailboxId: darrellMailbox.id,
        selfUserId: ADMIN_ID,
        mailbox: darrellMailbox,
        members: [],
      }),
      true,
    );
  });

  it("detects when actor has no eligible send mailbox", () => {
    const danielMailbox = mailbox();
    assert.equal(
      actorHasEligibleSendMailbox([danielMailbox], ADMIN_ID, {}),
      false,
    );
    const darrellMailbox = mailbox({
      id: "darrell-mailbox",
      address: "darrellkoo@echfronthk.com",
      createdBy: ADMIN_ID,
    });
    assert.equal(
      actorHasEligibleSendMailbox([danielMailbox, darrellMailbox], ADMIN_ID, {}),
      true,
    );
    assert.deepEqual(
      listActorEligibleSendMailboxes(
        [danielMailbox, darrellMailbox],
        ADMIN_ID,
        {},
      ).map((item) => item.id),
      ["darrell-mailbox"],
    );
  });

  it("describes personal mailbox owner and actor send eligibility for create form", () => {
    const view = resolveCreateFormMailboxView(
      mailbox(),
      mapGrantUserOptions([
        {
          id: DANIEL_ID,
          name: "Daniel.Hayes",
          email: "daniel.hayes@echfronthk.com",
          role: "staff",
          status: "active",
        },
      ]),
      ADMIN_ID,
      [],
    );
    assert.equal(view.ownerLabel, "Daniel.Hayes");
    assert.equal(view.actorCanSend, false);

    const ownedView = resolveCreateFormMailboxView(
      mailbox({ createdBy: ADMIN_ID, address: "darrellkoo@echfronthk.com" }),
      mapGrantUserOptions([
        {
          id: ADMIN_ID,
          name: "DarrellKoo",
          email: "darrellkoo@echfronthk.com",
          role: "admin",
          status: "active",
        },
      ]),
      ADMIN_ID,
      [],
    );
    assert.equal(ownedView.actorCanSend, true);
  });

  it("resolves compose mailbox from default mailbox only", () => {
    assert.equal(
      resolveComposeMailboxId(
        identity({ defaultMailboxId: MAILBOX_ID, sentFolderMailboxId: "other" }),
      ),
      MAILBOX_ID,
    );
    assert.equal(
      resolveComposeMailboxId(
        identity({ defaultMailboxId: null, sentFolderMailboxId: "sent-only" }),
      ),
      "sent-only",
    );
  });
});

describe("sender identity grant management UI wiring", () => {
  it("uses grant panel, CRM user picker, and self-grant checkbox", () => {
    const managementSource = readFileSync(
      "src/components/mail/admin/sender-identity-management.tsx",
      "utf8",
    );
    const panelSource = readFileSync(
      "src/components/mail/admin/sender-identity-grant-panel.tsx",
      "utf8",
    );

    assert.match(managementSource, /SenderIdentityGrantPanel/);
    assert.match(managementSource, /grantSelfOnCreate/);
    assert.match(managementSource, /fetchAdminUsersForMailAccess/);
    assert.match(managementSource, /grantSenderIdentityAccess/);
    assert.match(managementSource, /fetchSenderIdentityGrants/);
    assert.match(managementSource, /mailboxHelper/);
    assert.match(managementSource, /SenderIdentityCard/);
    assert.match(managementSource, /navigateToSection\("mailbox"\)/);
    assert.doesNotMatch(managementSource, /DataTable/);

    assert.match(panelSource, /fetchAdminUsersForMailAccess/);
    assert.match(panelSource, /grantSenderIdentityAccess/);
    assert.match(panelSource, /revokeSenderIdentityGrant/);
    assert.match(panelSource, /userSearchPlaceholder/);
    assert.match(panelSource, /GrantUserCard/);
    assert.doesNotMatch(panelSource, /DataTable/);
  });
});

describe("sender identity grant API client wiring", () => {
  it("routes grant writes through existing backend endpoints", () => {
    const source = readFileSync("src/lib/mail/client/api.ts", "utf8");
    assert.match(source, /senderIdentityGrantsPath/);
    assert.match(source, /senderIdentityGrantRevokePath/);
    assert.match(source, /fetchSenderIdentityGrants/);
    assert.match(source, /grantSenderIdentityAccess/);
    assert.match(source, /revokeSenderIdentityGrant/);
  });
});

describe("mailbox creation dependency", () => {
  it("documents existing personal mailbox create UI with owner selection", () => {
    const source = readFileSync(
      "src/components/mail/admin/mailbox-management.tsx",
      "utf8",
    );
    assert.match(source, /createMailbox/);
    assert.match(source, /ownerUserId/);
    assert.match(source, /listPersonalMailboxOwnerCandidates/);
  });
});
