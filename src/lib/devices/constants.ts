/** Default max approved devices per staff user. */
export const DEFAULT_DEVICE_AUTHORIZATION_LIMIT = 2;

/** Device cookie lifetime (~400 days, Chromium max). */
export const DEVICE_COOKIE_TTL_MS = 400 * 24 * 60 * 60 * 1000;

export const DEVICE_AUDIT_ACTIONS = {
  CREATED_PENDING: "device.created.pending",
  APPROVED: "device.approved",
  REJECTED: "device.rejected",
  REVOKED: "device.revoked",
  LOGIN_BLOCKED: "device.login.blocked",
  SESSION_REVOKED: "device.session.revoked",
  ADMIN_RECORDED: "device.admin.recorded",
  LOGIN_SUCCESS: "device.login.success",
  REAPPROVAL_REQUESTED: "device.reapproval.requested",
} as const;

export const DEVICE_LOGIN_MESSAGES = {
  NEW_PENDING: "此設備尚未授權，請聯繫管理員。",
  PENDING_REVIEW: "此設備正在等待管理員審核，請稍後再試。",
  LIMIT_REACHED: "此帳號已達到設備數量上限，請聯繫管理員移除舊設備。",
  REVOKED: "此設備授權已被撤銷，請聯繫管理員。",
  REJECTED: "此設備授權申請已被拒絕，請聯繫管理員。",
  REAPPROVAL_PENDING: "此設備已重新提交授權申請，請等待管理員審核。",
} as const;
