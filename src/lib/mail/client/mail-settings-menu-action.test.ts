import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveMailSettingsMenuSelect } from "@/lib/mail/client/mail-settings-menu-action";

describe("resolveMailSettingsMenuSelect", () => {
  it("opens admin center when admin entry is allowed and handler exists", () => {
    assert.deepEqual(
      resolveMailSettingsMenuSelect("admin", {
        showAdminEntry: true,
        hasAdminCenterHandler: true,
      }),
      { action: "open_admin_center" },
    );
  });

  it("does not open admin center when entry is hidden", () => {
    assert.equal(
      resolveMailSettingsMenuSelect("admin", {
        showAdminEntry: false,
        hasAdminCenterHandler: true,
      }),
      null,
    );
  });

  it("does not open admin center when handler is missing", () => {
    assert.equal(
      resolveMailSettingsMenuSelect("admin", {
        showAdminEntry: true,
        hasAdminCenterHandler: false,
      }),
      null,
    );
  });

  it("routes notifications to placeholder sections", () => {
    assert.deepEqual(
      resolveMailSettingsMenuSelect("notifications", {
        showAdminEntry: false,
        hasAdminCenterHandler: false,
      }),
      { action: "show_section", view: "notifications" },
    );
  });

  it("routes signature to placeholder section", () => {
    assert.deepEqual(
      resolveMailSettingsMenuSelect("signature", {
        showAdminEntry: false,
        hasAdminCenterHandler: false,
      }),
      { action: "show_section", view: "signature" },
    );
  });

  it("opens notification mailbox self-service when entry is enabled", () => {
    assert.deepEqual(
      resolveMailSettingsMenuSelect("notificationMailbox", {
        showAdminEntry: false,
        hasAdminCenterHandler: false,
        showNotificationMailboxEntry: true,
        hasNotificationMailboxHandler: true,
      }),
      { action: "open_notification_mailbox" },
    );
  });

  it("does not open notification mailbox when handler is missing", () => {
    assert.equal(
      resolveMailSettingsMenuSelect("notificationMailbox", {
        showAdminEntry: false,
        hasAdminCenterHandler: false,
        showNotificationMailboxEntry: true,
        hasNotificationMailboxHandler: false,
      }),
      null,
    );
  });
});
