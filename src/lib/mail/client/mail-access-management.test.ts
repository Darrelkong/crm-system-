import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  buildMailAccessUserRows,
  canManageMailAccess,
  isMissingVerifiedNotificationIdentityError,
  mailAccessDisablePath,
  mailAccessEnablePath,
  resolveMailAccessEnableApiFeedback,
  resolveMailAccessEnablePreCheck,
  resolveMailAccessListErrorFeedback,
  resolveMailAccessRowActions,
  type MailAccessApiItem,
  type MailAccessAdminUser,
} from "@/lib/mail/client/mail-access-management";

const USERS: MailAccessAdminUser[] = [
  {
    id: "user-a",
    name: "Alice",
    email: "alice@example.com",
    status: "active",
  },
  {
    id: "user-b",
    name: "Bob",
    email: "bob@example.com",
    status: "active",
  },
  {
    id: "user-deleted",
    name: "Deleted",
    email: "deleted@example.com",
    status: "deleted",
  },
];

const ACCESS_ITEMS: MailAccessApiItem[] = [
  {
    userId: "user-a",
    isEnabled: 1,
    enabledAt: "2026-08-22T08:00:00.000Z",
    disabledAt: null,
    createdAt: "2026-08-21T08:00:00.000Z",
    updatedAt: "2026-08-22T08:00:00.000Z",
    hasVerifiedNotificationIdentity: true,
  },
  {
    userId: "user-b",
    isEnabled: 0,
    enabledAt: null,
    disabledAt: "2026-08-20T08:00:00.000Z",
    createdAt: "2026-08-19T08:00:00.000Z",
    updatedAt: "2026-08-20T08:00:00.000Z",
    hasVerifiedNotificationIdentity: false,
  },
];

describe("canManageMailAccess", () => {
  it("returns false when accessManagement capability is missing", () => {
    assert.equal(canManageMailAccess({ accessManagement: false }), false);
  });

  it("returns true when accessManagement capability is granted", () => {
    assert.equal(canManageMailAccess({ accessManagement: true }), true);
  });
});

describe("resolveMailAccessRowActions", () => {
  const enabledRow = buildMailAccessUserRows(USERS, ACCESS_ITEMS)[0]!;
  const disabledRow = buildMailAccessUserRows(USERS, ACCESS_ITEMS)[1]!;

  it("hides actions when permission is missing", () => {
    assert.deepEqual(resolveMailAccessRowActions(enabledRow, false), {
      showEnable: false,
      showDisable: false,
    });
    assert.deepEqual(resolveMailAccessRowActions(disabledRow, false), {
      showEnable: false,
      showDisable: false,
    });
  });

  it("shows enable action for disabled users when permitted", () => {
    assert.deepEqual(resolveMailAccessRowActions(disabledRow, true), {
      showEnable: true,
      showDisable: false,
    });
  });

  it("shows disable action for enabled users when permitted", () => {
    assert.deepEqual(resolveMailAccessRowActions(enabledRow, true), {
      showEnable: false,
      showDisable: true,
    });
  });
});

describe("buildMailAccessUserRows", () => {
  it("merges admin users with mail access records and excludes deleted users", () => {
    const rows = buildMailAccessUserRows(USERS, ACCESS_ITEMS);
    assert.equal(rows.length, 2);
    assert.equal(rows[0]?.name, "Alice");
    assert.equal(rows[0]?.isEnabled, true);
    assert.equal(rows[0]?.enabledAt, "2026-08-22T08:00:00.000Z");
    assert.equal(rows[1]?.name, "Bob");
    assert.equal(rows[1]?.isEnabled, false);
    assert.equal(rows[1]?.hasAccessRecord, true);
  });

  it("marks users without access records as disabled", () => {
    const rows = buildMailAccessUserRows(
      [
        {
          id: "user-c",
          name: "Carol",
          email: "carol@example.com",
          status: "active",
        },
      ],
      [],
    );
    assert.equal(rows[0]?.isEnabled, false);
    assert.equal(rows[0]?.hasAccessRecord, false);
    assert.equal(rows[0]?.enabledAt, null);
  });
});

describe("mail access API paths", () => {
  it("builds enable and disable endpoints for a target user", () => {
    assert.equal(
      mailAccessEnablePath("user-a"),
      "/api/mail/access/user-a/enable",
    );
    assert.equal(
      mailAccessDisablePath("user/a"),
      "/api/mail/access/user%2Fa/disable",
    );
  });
});

describe("resolveMailAccessEnablePreCheck", () => {
  const disabledRow = buildMailAccessUserRows(USERS, ACCESS_ITEMS)[1]!;

  it("returns missing identity feedback when verified identity is absent", () => {
    assert.deepEqual(
      resolveMailAccessEnablePreCheck({
        row: disabledRow,
        selfUserId: "user-b",
        canConfigureNotificationIdentity: true,
      }),
      {
        kind: "missingIdentity",
        showConfigureAction: true,
      },
    );
  });

  it("hides configure action for other users without verified identity", () => {
    assert.deepEqual(
      resolveMailAccessEnablePreCheck({
        row: disabledRow,
        selfUserId: "user-a",
        canConfigureNotificationIdentity: true,
      }),
      {
        kind: "missingIdentity",
        showConfigureAction: false,
      },
    );
  });

  it("returns null when verified notification identity exists", () => {
    const enabledRow = buildMailAccessUserRows(USERS, ACCESS_ITEMS)[0]!;
    assert.equal(
      resolveMailAccessEnablePreCheck({
        row: enabledRow,
        selfUserId: "user-a",
        canConfigureNotificationIdentity: true,
      }),
      null,
    );
  });
});

describe("resolveMailAccessEnableApiFeedback", () => {
  it("maps missing verified notification identity conflict to guided flow", () => {
    assert.deepEqual(
      resolveMailAccessEnableApiFeedback({
        status: 409,
        error:
          "Verified notification identity is required before enabling Mail access",
        errorCode: "CONFLICT",
        targetUserId: "user-b",
        selfUserId: "user-b",
        canConfigureNotificationIdentity: true,
      }),
      {
        kind: "missingIdentity",
        showConfigureAction: true,
      },
    );
  });

  it("maps forbidden responses to permission denied feedback", () => {
    assert.deepEqual(
      resolveMailAccessEnableApiFeedback({
        status: 403,
        error: "Mail access denied",
        errorCode: "FORBIDDEN",
        targetUserId: "user-b",
        selfUserId: "user-a",
        canConfigureNotificationIdentity: true,
      }),
      { kind: "permissionDenied" },
    );
  });

  it("maps other failures to generic retry feedback", () => {
    assert.deepEqual(
      resolveMailAccessEnableApiFeedback({
        status: 500,
        error: "Server error",
        errorCode: "SERVER_ERROR",
        targetUserId: "user-b",
        selfUserId: "user-b",
        canConfigureNotificationIdentity: true,
      }),
      { kind: "genericError" },
    );
  });

  it("returns success-equivalent only through pre-check null and direct enable", () => {
    assert.equal(
      resolveMailAccessEnablePreCheck({
        row: buildMailAccessUserRows(USERS, ACCESS_ITEMS)[0]!,
        selfUserId: "user-a",
        canConfigureNotificationIdentity: true,
      }),
      null,
    );
  });
});

describe("resolveMailAccessListErrorFeedback", () => {
  it("maps forbidden list responses to permission denied", () => {
    assert.equal(
      resolveMailAccessListErrorFeedback({ status: 403, errorCode: "FORBIDDEN" }),
      "permissionDenied",
    );
  });
});

describe("isMissingVerifiedNotificationIdentityError", () => {
  it("detects verified notification identity conflict errors", () => {
    assert.equal(
      isMissingVerifiedNotificationIdentityError({
        error:
          "Verified notification identity is required before enabling Mail access",
        errorCode: "CONFLICT",
      }),
      true,
    );
    assert.equal(
      isMissingVerifiedNotificationIdentityError({
        error: "User already enabled",
        errorCode: "CONFLICT",
      }),
      false,
    );
  });
});

describe("mail access management onboarding wiring", () => {
  it("guides users to notification identity setup from enable flow", () => {
    const source = readFileSync(
      "src/components/mail/admin/mail-access-management.tsx",
      "utf8",
    );
    assert.match(source, /resolveMailAccessEnablePreCheck/);
    assert.match(source, /resolveMailAccessEnableApiFeedback/);
    assert.match(source, /notificationIdentityRequired/);
    assert.match(source, /configureNotificationIdentity/);
    assert.match(source, /navigateToSection\("notificationIdentity"\)/);
    assert.match(source, /MailAccessEnableFeedbackPanel/);
  });
});
