import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  VERIFICATION_CODE_INPUT_PROPS,
} from "@/lib/mail/client/notification-verification-client";

function read(path: string): string {
  return readFileSync(path, "utf8");
}

describe("notification identity UX correction wiring", () => {
  it("admin notification identity uses full team overview control plane", () => {
    const admin = read("src/components/mail/admin/notification-identity-management.tsx");
    const overview = read("src/components/mail/admin/notification-identity-team-overview.tsx");
    assert.match(admin, /NotificationIdentityTeamOverview/);
    assert.match(overview, /fetchAdminUsersForMailAccess/);
    assert.match(overview, /NotificationIdentitySettingsModal/);
    assert.match(overview, /NotificationIdentityOtpModal/);
    assert.match(overview, /TargetUserNotificationIdentityPanel/);
    assert.doesNotMatch(admin, /NotificationIdentityTeamMemberSelector/);
    assert.doesNotMatch(admin, /selfOnlyHint/);
  });

  it("staff self-service entry is wired through mail settings", () => {
    const popover = read("src/components/mail/prototype/mail-settings-popover.tsx");
    const shell = read("src/components/mail/prototype/mail-prototype-shell.tsx");
    const selfService = read(
      "src/components/mail/notification-mailbox-self-service-modal.tsx",
    );
    assert.match(popover, /notificationMailbox/);
    assert.match(popover, /mail\.notificationMailbox\.title/);
    assert.match(shell, /NotificationMailboxSelfServiceModal/);
    assert.match(selfService, /NotificationIdentityControlView/);
    assert.doesNotMatch(selfService, /NotificationIdentityTeamMemberSelector/);
  });

  it("uses dedicated OTP modal instead of inline verification form", () => {
    const control = read("src/components/mail/admin/notification-identity-control-view.tsx");
    const otp = read("src/components/mail/admin/notification-identity-otp-modal.tsx");
    assert.match(control, /NotificationIdentityOtpModal/);
    assert.match(otp, /ModalOverlay/);
    assert.match(otp, /VERIFICATION_CODE_INPUT_PROPS/);
    assert.doesNotMatch(control, /verifyCodeInput/);
    assert.doesNotMatch(control, /NotificationIdentityVerifyForm/);
  });

  it("does not repurpose proof diagnostic token modal for OTP entry", () => {
    const proofTools = read("src/components/mail/admin/notification-identity-proof-tools.tsx");
    const otp = read("src/components/mail/admin/notification-identity-otp-modal.tsx");
    assert.match(proofTools, /NotificationIdentityProofTokenModal/);
    assert.match(proofTools, /NotificationIdentityProofTools/);
    assert.doesNotMatch(otp, /tokenModalTitle/);
    assert.doesNotMatch(otp, /issueToken/);
  });

  it("moves advanced verification tools to proof diagnostics only", () => {
    const admin = read("src/components/mail/admin/notification-identity-management.tsx");
    const proof = read("src/components/mail/admin/proof-diagnostics.tsx");
    assert.doesNotMatch(admin, /AdvancedVerificationTools/);
    assert.match(proof, /NotificationIdentityProofDiagnosticsPanel/);
  });

  it("uses one canonical status summary without duplicate primary cards", () => {
    const control = read("src/components/mail/admin/notification-identity-control-view.tsx");
    const summary = read(
      "src/components/mail/admin/notification-identity-status-summary.tsx",
    );
    assert.match(control, /NotificationIdentityStatusSummary/);
    assert.doesNotMatch(control, /IdentityStatusPanel/);
    assert.doesNotMatch(summary, /DataTable/);
  });

  it("only renders verification expiry when the server provides one", () => {
    const summary = read(
      "src/components/mail/admin/notification-identity-status-summary.tsx",
    );
    assert.match(summary, /status === "pending" && item\.verificationExpiresAt/);
    assert.match(summary, /formatHongKongDateTime\(item\.verificationExpiresAt\)/);
    assert.doesNotMatch(summary, /verificationRequestedAt.*\+.*300/);
  });

  it("shared modal shell uses viewport-centered grid overlay", () => {
    const modal = read("src/components/ui/modal.tsx");
    const css = read("src/app/globals.css");
    assert.match(modal, /createPortal/);
    assert.match(modal, /document\.body/);
    assert.match(modal, /modal-overlay-center/);
    assert.match(css, /\.modal-overlay[\s\S]*display:\s*grid/);
    assert.match(css, /place-items:\s*center/);
    assert.match(css, /100dvh/);
    assert.match(css, /safe-area-inset/);
    assert.match(css, /\.modal-panel-body/);
  });

  it("settings and OTP modals use shared modal shell with internal scroll body", () => {
    const settings = read(
      "src/components/mail/admin/notification-identity-settings-modal.tsx",
    );
    const otp = read("src/components/mail/admin/notification-identity-otp-modal.tsx");
    assert.match(settings, /ModalOverlay/);
    assert.match(settings, /modal-panel-body/);
    assert.match(otp, /modal-panel-body/);
  });

  it("preserves 8-character OTP input constraints in dedicated modal", () => {
    assert.equal(VERIFICATION_CODE_INPUT_PROPS.maxLength, 8);
    const otp = read("src/components/mail/admin/notification-identity-otp-modal.tsx");
    assert.match(otp, /VERIFICATION_CODE_INPUT_PROPS/);
    assert.match(otp, /verifyCodeInput\.length !== VERIFICATION_CODE_INPUT_PROPS\.maxLength/);
  });

  it("staff self-service modal uses session user only and no team overview", () => {
    const selfService = read(
      "src/components/mail/notification-mailbox-self-service-modal.tsx",
    );
    assert.match(selfService, /session\?\.user/);
    assert.match(selfService, /targetUserId=\{user\.id\}/);
    assert.doesNotMatch(selfService, /NotificationIdentityTeamMemberSelector/);
    assert.doesNotMatch(selfService, /NotificationIdentityTeamOverview/);
  });

  it("admin self-service entry remains separate from team overview", () => {
    const shell = read("src/components/mail/prototype/mail-prototype-shell.tsx");
    const admin = read("src/components/mail/admin/notification-identity-management.tsx");
    assert.match(shell, /NotificationMailboxSelfServiceModal/);
    assert.match(admin, /NotificationIdentityTeamOverview/);
    assert.doesNotMatch(shell, /NotificationIdentityTeamOverview/);
  });

  it("canonical lifecycle management title uses management wording", () => {
    const zhHant = read("src/i18n/locales/zh-Hant.ts");
    const panel = read(
      "src/components/mail/admin/target-user-notification-identity-panel.tsx",
    );
    const selfService = read(
      "src/components/mail/notification-mailbox-self-service-modal.tsx",
    );
    assert.match(zhHant, /title: "通知郵箱管理"/);
    assert.doesNotMatch(zhHant, /title: "通知郵箱設定"/);
    assert.match(panel, /mail\.adminCenter\.access\.targetNotification\.title/);
    assert.match(selfService, /mail\.adminCenter\.access\.targetNotification\.title/);
  });

  it("pending-only OTP modal keeps normal verification wording", () => {
    const zhHant = read("src/i18n/locales/zh-Hant.ts");
    const otp = read("src/components/mail/admin/notification-identity-otp-modal.tsx");
    assert.match(zhHant, /otpModalTitle: "驗證通知郵箱"/);
    assert.match(zhHant, /otpModalSentTo: "我們已向以下郵箱發送 8 位驗證碼："/);
    assert.match(otp, /replacementPending\s*\?\s*t\("mail\.notificationMailbox\.otpModalReplacementTitle"\)/);
    assert.match(otp, /:\s*t\("mail\.notificationMailbox\.otpModalTitle"\)/);
    assert.match(otp, /:\s*t\("mail\.notificationMailbox\.otpModalSentTo"\)/);
  });

  it("replacement OTP modal uses replacement-specific title and primary action", () => {
    const zhHant = read("src/i18n/locales/zh-Hant.ts");
    const otp = read("src/components/mail/admin/notification-identity-otp-modal.tsx");
    assert.match(zhHant, /otpModalReplacementTitle: "完成通知郵箱更換"/);
    assert.match(zhHant, /otpModalReplacementVerifyAction: "驗證並完成更換"/);
    assert.match(otp, /otpModalReplacementTitle/);
    assert.match(otp, /otpModalReplacementBody/);
    assert.match(otp, /otpModalReplacementVerifyAction/);
  });

  it("replacement workflow keeps normal action group separate from disable area", () => {
    const zhHant = read("src/i18n/locales/zh-Hant.ts");
    const control = read("src/components/mail/admin/notification-identity-control-view.tsx");
    assert.match(zhHant, /completeReplacementAction: "完成更換"/);
    assert.match(control, /completeActionLabel/);
    assert.match(control, /formatVerificationResendActionLabel/);
    assert.match(control, /cancelActionLabel/);
    assert.match(control, /notification-identity-disable-section/);
    assert.match(control, /disableSectionTitle/);
    assert.match(control, /disableSectionDescription/);
    const actionRowEnd = control.indexOf("notification-identity-disable-section");
    const actionRowStart = control.indexOf('className="flex flex-wrap gap-2"');
    assert.ok(actionRowStart >= 0 && actionRowEnd > actionRowStart);
    assert.doesNotMatch(
      control.slice(actionRowStart, actionRowEnd),
      /variant="danger"/,
    );
  });

  it("does not change notification identity API or service wiring", () => {
    const control = read("src/components/mail/admin/notification-identity-control-view.tsx");
    assert.match(control, /cancelPendingNotificationIdentity/);
    assert.match(control, /disableNotificationIdentity/);
    assert.match(control, /sendTargetNotificationVerificationChallenge/);
    assert.doesNotMatch(control, /notification-identity-service/);
    assert.doesNotMatch(control, /\/api\/mail\/access/);
  });
});
