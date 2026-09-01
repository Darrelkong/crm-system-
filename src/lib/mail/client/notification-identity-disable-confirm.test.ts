import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  scheduleDisableConfirmArm,
  shouldAllowDisableConfirmAction,
} from "@/lib/mail/client/notification-identity-disable-confirm-behavior";

function read(path: string): string {
  return readFileSync(path, "utf8");
}

describe("notification identity disable confirmation behavior", () => {
  it("blocks confirm action until armed and not busy", () => {
    assert.equal(
      shouldAllowDisableConfirmAction({ armed: false, busy: false }),
      false,
    );
    assert.equal(
      shouldAllowDisableConfirmAction({ armed: true, busy: true }),
      false,
    );
    assert.equal(
      shouldAllowDisableConfirmAction({ armed: true, busy: false }),
      true,
    );
  });

  it("arms confirm only after the opening pointer event frame", async () => {
    let armed = false;
    const cancel = scheduleDisableConfirmArm(() => {
      armed = true;
    });

    assert.equal(armed, false);
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
    assert.equal(armed, true);
    cancel();
  });

  it("simulates same-click-through: confirm cannot fire before arm", async () => {
    let disableCalls = 0;
    let armed = false;

    const cancel = scheduleDisableConfirmArm(() => {
      armed = true;
    });

    if (shouldAllowDisableConfirmAction({ armed, busy: false })) {
      disableCalls += 1;
    }
    assert.equal(disableCalls, 0);

    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });

    if (shouldAllowDisableConfirmAction({ armed, busy: false })) {
      disableCalls += 1;
    }
    assert.equal(disableCalls, 1);
    cancel();
  });
});

describe("notification identity disable confirmation wiring", () => {
  const control = read(
    "src/components/mail/admin/notification-identity-control-view.tsx",
  );
  const confirmModal = read(
    "src/components/mail/admin/notification-identity-revoke-confirm-modal.tsx",
  );
  const selfService = read(
    "src/components/mail/notification-mailbox-self-service-modal.tsx",
  );
  const adminPanel = read(
    "src/components/mail/admin/target-user-notification-identity-panel.tsx",
  );

  it("outer destructive button only schedules opening the confirm modal", () => {
    assert.match(control, /setRevokeConfirmOpen\(true\)/);
    assert.match(control, /requestAnimationFrame/);
    assert.doesNotMatch(
      control.slice(control.indexOf("notification-identity-revoke-section")),
      /onClick=\{\(\) => void handleDisableConfirmed\(\)\}/,
    );
    assert.doesNotMatch(
      control.slice(control.indexOf("notification-identity-revoke-section")),
      /revokeNotificationIdentity\(/,
    );
  });

  it("confirm modal guards destructive action until armed", () => {
    assert.match(confirmModal, /shouldAllowDisableConfirmAction/);
    assert.match(confirmModal, /scheduleDisableConfirmArm/);
    assert.match(confirmModal, /disabled=\{!canConfirm\}/);
    assert.match(confirmModal, /if \(!canConfirm\)/);
  });

  it("cancel closes modal without invoking revoke API in control view", () => {
    assert.match(control, /onClose=\{\(\) => setRevokeConfirmOpen\(false\)\}/);
    assert.match(
      control,
      /onConfirm=\{\(\) => void handleSecurityRevokeConfirmed\(\)\}/,
    );
    assert.equal(
      (control.match(/revokeNotificationIdentity\(/g) ?? []).length,
      1,
    );
  });

  it("self-service and admin canonical surfaces share the same control contract", () => {
    assert.match(selfService, /NotificationIdentityControlView/);
    assert.match(adminPanel, /NotificationIdentityControlView/);
    assert.match(control, /NotificationIdentityRevokeConfirmModal/);
  });

  it("busy state prevents duplicate disable submission", () => {
    assert.match(control, /setLifecycleBusy\(true\)/);
    assert.match(control, /disabled=\{lifecycleBusy\}/);
    assert.match(confirmModal, /busy \? undefined : onClose/);
    assert.match(confirmModal, /disabled=\{!canConfirm\}/);
  });

  it("failure path keeps modal open until success closes it", () => {
    assert.match(control, /if \(!result\.ok\)/);
    assert.match(control, /setRevokeConfirmOpen\(false\)/);
    const successIndex = control.indexOf("setRevokeConfirmOpen(false)");
    const failureIndex = control.indexOf("if (!result.ok)");
    assert.ok(failureIndex < successIndex);
  });
});
