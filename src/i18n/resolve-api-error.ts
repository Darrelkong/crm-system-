type TranslateFn = (
  key: string,
  params?: Record<string, string>,
) => string;

export type ValidationFieldError = {
  field: string;
  message: string;
  code?: string;
};

const ERROR_CODE_TO_KEY: Record<string, string> = {
  CUSTOMER_NOT_FOUND: "errors.customerNotFound",
  VALIDATION_FAILED: "errors.validationFailed",
  DUPLICATE_CUSTOMER: "errors.duplicateCustomer",
  INSUFFICIENT_PERMISSIONS: "errors.insufficientPermissions",
  SAVE_FAILED: "errors.saveFailed",
  DELETE_FAILED: "errors.deleteFailed",
  SERVER_ERROR: "errors.serverError",
  APPROVAL_NOT_FOUND: "errors.approvalNotFound",
  APPROVAL_ALREADY_PROCESSED: "errors.approvalAlreadyProcessed",
  PUBLIC_POOL_CLIENT_NOT_FOUND: "errors.publicPoolClientNotFound",
  PUBLIC_POOL_CLIENT_ALREADY_CLAIMED: "errors.publicPoolClientAlreadyClaimed",
  PUBLIC_POOL_REQUIRES_RELEASE_FLOW: "errors.publicPoolRequiresReleaseFlow",
  CLIENT_ALREADY_CLAIMED: "errors.clientAlreadyClaimed",
  IMPORT_FILE_REQUIRED: "errors.importFileRequired",
  IMPORT_INVALID_FILE_FORMAT: "errors.importInvalidFileFormat",
  IMPORT_FAILED: "errors.importFailed",
  CLAIM_SELF_RELEASED: "errors.claimSelfReleased",
  CLAIM_COOLDOWN: "errors.claimCooldown",
  CLAIM_QUOTA_EXCEEDED: "errors.claimQuotaExceeded",
  CLAIM_STATUS_UNAVAILABLE: "errors.claimStatusUnavailable",
  CANNOT_CLAIM_CLIENT: "errors.cannotClaimClient",
  MARK_NOTIFICATION_FAILED: "errors.markNotificationFailed",
  NOTIFICATION_NOT_FOUND: "errors.notificationNotFound",
  DASHBOARD_LOAD_FAILED: "errors.dashboardLoadFailed",
  MISSING_JOB_ID: "errors.missingJobId",
  UNAUTHORIZED: "errors.unauthorized",
  ACCESS_VERIFICATION_EXPIRED: "security.accessExpired",
  ACCOUNT_LOCKED: "auth.accountLocked",
  UNAUTHORIZED_EMAIL: "auth.unauthorizedEmailMessage",
  IP_EMAIL_RESTRICTED: "auth.ipEmailRestrictedMessage",
  SESSION_IDLE_EXPIRED: "security.sessionTimedOutReLogin",
  SESSION_REVOKED: "security.sessionRevokedByOtherDevice",
  SESSION_INVALID: "security.sessionInvalidReLogin",
  SESSION_DEVICE_REVOKED: "security.deviceAuthorizationRevoked",
  SESSION_ACCESS_REVERIFY_REQUIRED: "security.accessReverifyRequired",
  DEVICE_NEW_PENDING: "auth.deviceNewPending",
  DEVICE_PENDING_REVIEW: "auth.devicePendingReview",
  DEVICE_REJECTED: "auth.deviceRejected",
  DEVICE_REVOKED: "auth.deviceRevoked",
  DEVICE_LIMIT_REACHED: "auth.deviceLimitReached",
  DEVICE_REAPPROVAL_PENDING: "auth.deviceReapprovalPending",
  INITIAL_ACTIVATION_STATE_CHANGED: "auth.initialActivationStateChanged",
  ON_HOLD_REASON_REQUIRED: "errors.onHoldReasonRequired",
  ON_HOLD_REASON_TOO_SHORT: "errors.onHoldReasonTooShort",
  validation: "errors.validationFailed",
  job_not_found: "importErrorTypes.jobNotFound",
  job_not_owned: "importErrorTypes.jobNotOwned",
  job_already_completed: "importErrorTypes.jobAlreadyCompleted",
  job_already_failed: "importErrorTypes.jobAlreadyFailed",
  job_invalid_status: "importErrorTypes.jobInvalidStatus",
  job_has_errors: "importErrorTypes.jobHasErrors",
  precheck_has_errors: "importErrorTypes.precheckHasErrors",
  precheck_mismatch: "importErrorTypes.precheckMismatch",
  "permission.denied.customer_access": "errors.insufficientPermissions",
  "permission.denied.customer_edit": "errors.cannotEditCustomer",
  "permission.denied.customer_status_change": "errors.cannotChangeCustomerStatus",
  "permission.denied.customer_sensitive_fields_locked":
    "errors.customerSensitiveFieldsLocked",
  CUSTOMER_SENSITIVE_FIELDS_LOCKED: "errors.customerSensitiveFieldsLocked",
  "permission.denied.follow_up_access": "errors.cannotAddFollowUp",
  "permission.denied.customer_timeline_access": "errors.cannotViewTimeline",
  "customer.release_to_pool_failed.permission_denied": "errors.cannotReleaseCustomer",
  ASSIGNEE_INVALID_PAYLOAD: "errors.assigneeInvalidPayload",
  ASSIGNEE_OWNER_NOT_ALLOWED: "errors.assigneeOwnerNotAllowed",
  ASSIGNEE_ADMIN_NOT_ALLOWED: "errors.assigneeAdminNotAllowed",
  ASSIGNEE_INACTIVE_USER: "errors.assigneeInactiveUser",
  ASSIGNEE_USER_NOT_FOUND: "errors.assigneeUserNotFound",
  CUSTOMER_ASSIGNEES_FORBIDDEN: "errors.customerAssigneesForbidden",
  PENDING_ON_HOLD_CREATE: "errors.pendingOnHoldCreate",
  "permission.denied.customer_assignees_manage": "errors.customerAssigneesForbidden",
  "permission.denied.pending_on_hold_create": "errors.pendingOnHoldCreate",
  "customer.assignees.manage_failed.archived": "errors.customerAssigneesForbidden",
  ASSIGNEE_REASON_REQUIRED: "errors.assigneeReasonRequired",
  ASSIGNEE_REASON_TOO_SHORT: "errors.assigneeReasonTooShort",
  ASSIGNEE_APPROVAL_ALREADY_PENDING: "errors.assigneeApprovalAlreadyPending",
  ASSIGNEE_APPROVAL_INVALID_PAYLOAD: "errors.assigneeApprovalInvalidPayload",
  ASSIGNEE_APPROVAL_FORBIDDEN: "errors.assigneeApprovalForbidden",
  MERGE_CUSTOMERS_DISABLED: "errors.mergeCustomersDisabled",
  "permission.denied.customer_assignees_request": "errors.assigneeApprovalForbidden",
  "permission.denied.customer_assignees_request_admin": "errors.assigneeApprovalForbidden",
};

const FIELD_CODE_TO_KEY: Record<string, string> = {
  CUSTOMER_NAME_REQUIRED: "errors.clientNameRequired",
  INVALID_CUSTOMER_NAME: "errors.invalidCustomerName",
  REQUESTED_PROJECT_NAME_REQUIRED: "errors.requestedProjectNameRequired",
  INVALID_REQUESTED_PROJECT_NAME: "errors.invalidRequestedProjectName",
  STAGE_NOTES_REQUIRED: "errors.stageNotesRequired",
  CURRENT_PASSWORD_REQUIRED: "errors.currentPasswordRequired",
  CURRENT_PASSWORD_INVALID: "errors.currentPasswordInvalid",
  NEW_PASSWORD_REQUIRED: "errors.newPasswordRequired",
  CONFIRM_PASSWORD_REQUIRED: "errors.confirmPasswordRequired",
  PASSWORD_CONFIRM_MISMATCH: "errors.passwordConfirmMismatch",
  PASSWORD_SAME_AS_OLD: "errors.passwordSameAsOld",
  PASSWORD_TOO_SHORT: "errors.passwordTooShort",
  PASSWORD_BLANK: "errors.passwordBlank",
  PASSWORD_MISSING_LETTER: "errors.passwordMissingLetter",
  PASSWORD_MISSING_UPPERCASE: "errors.passwordMissingUppercase",
  PASSWORD_MISSING_LOWERCASE: "errors.passwordMissingLowercase",
  PASSWORD_MISSING_DIGIT: "errors.passwordMissingDigit",
  PASSWORD_POLICY_FAILED: "errors.passwordPolicyFailed",
  MUST_CHANGE_PASSWORD: "auth.changePasswordSubtitle",
  PHONE_OR_WECHAT_REQUIRED: "errors.phoneOrWechatRequired",
  INVALID_PHONE_CN: "errors.invalidPhoneCn",
  INVALID_EMAIL: "errors.invalidEmail",
  SOURCE_REQUIRED: "errors.sourceRequired",
  SOURCE_REMARK_REQUIRED: "errors.sourceRemarkRequired",
  INVALID_CUSTOMER_TYPE: "errors.invalidCustomerType",
  INVALID_SALES_STAGE: "errors.invalidSalesStage",
  SALES_STAGE_DIRECT_TERMINAL_BLOCKED: "errors.salesStageDirectTerminalBlocked",
  ON_HOLD_REASON_REQUIRED: "errors.onHoldReasonRequired",
  ON_HOLD_REASON_TOO_SHORT: "errors.onHoldReasonTooShort",
  ASSIGNEE_REASON_REQUIRED: "errors.assigneeReasonRequired",
  ASSIGNEE_REASON_TOO_SHORT: "errors.assigneeReasonTooShort",
  MERGE_CUSTOMERS_DISABLED: "errors.mergeCustomersDisabled",
  SALES_STAGE_REQUIRED: "errors.salesStageRequired",
  INVALID_STATUS: "errors.invalidStatus",
  FOLLOW_UP_CHANNEL_REQUIRED: "errors.followUpChannelRequired",
  FOLLOW_UP_OUTCOME_REQUIRED: "errors.followUpOutcomeRequired",
  FOLLOW_UP_SUMMARY_REQUIRED: "errors.followUpSummaryRequired",
  FOLLOW_UP_SUMMARY_TOO_SHORT: "errors.followUpSummaryTooShort",
  NEXT_FOLLOW_UP_REQUIRED: "errors.nextFollowUpRequired",
  NEXT_FOLLOW_UP_INVALID: "errors.nextFollowUpInvalid",
  NEXT_FOLLOW_UP_TOO_SOON: "errors.nextFollowUpTooSoon",
  CUSTOMER_INTENT_REQUIRED: "errors.customerIntentRequired",
  NEXT_ACTION_REQUIRED: "errors.nextActionRequired",
  NEXT_ACTION_TOO_SHORT: "errors.nextActionTooShort",
  INVALID_FOLLOW_UP_TIME: "errors.invalidFollowUpTime",
  INVALID_NEXT_FOLLOW_UP_TIME: "errors.invalidNextFollowUpTime",
  RELEASE_REASON_REQUIRED: "errors.releaseReasonRequired",
};

/** Fallback mapping for legacy Chinese API messages. */
const CHINESE_MESSAGE_TO_KEY: Record<string, string> = {
  "客户不存在": "errors.customerNotFound",
  "客户不存在。": "errors.customerNotFound",
  "无权访问该客户": "errors.insufficientPermissions",
  "无权查看该客户完整资料": "errors.insufficientPermissions",
  "无权编辑该客户": "errors.cannotEditCustomer",
  "敏感資料不可由員工修改": "errors.customerSensitiveFieldsLocked",
  "敏感资料不可由员工修改": "errors.customerSensitiveFieldsLocked",
  "无权编辑公共池客户": "errors.cannotEditPublicPool",
  "无权为该客户添加跟进": "errors.cannotAddFollowUp",
  "无权查看该客户跟进记录": "errors.cannotViewFollowUps",
  "无权查看已归档客户的跟进记录": "errors.cannotViewFollowUps",
  "无权查看该客户时间线": "errors.cannotViewTimeline",
  "无权释放该客户": "errors.cannotReleaseCustomer",
  "客户已在公共池": "errors.customerAlreadyInPool",
  "输入校验失败": "errors.validationFailed",
  "存在重复客户": "errors.duplicateCustomer",
  "保存失败，请稍后重试": "errors.saveFailed",
  "提交失败": "errors.saveFailed",
  "释放失败": "errors.saveFailed",
  "服务器错误": "errors.serverError",
  "客户名称必填": "errors.clientNameRequired",
  "手机号和微信号至少填写一个": "errors.phoneOrWechatRequired",
  "请至少填写手机号或微信号": "errors.phoneOrWechatRequired",
  "+86 手机号必须为 11 位数字，且以 1 开头": "errors.invalidPhoneCn",
  "Email 格式不正确，必须包含 @": "errors.invalidEmail",
  "请从固定字典选择客户来源": "errors.sourceRequired",
  "来源为「其他」时，备注必填": "errors.sourceRemarkRequired",
  "客户类型无效": "errors.invalidCustomerType",
  "销售阶段无效": "errors.invalidSalesStage",
  "客户状态无效": "errors.invalidStatus",
  "请选择有效的跟进渠道": "errors.followUpChannelRequired",
  "请选择有效的跟进结果": "errors.followUpOutcomeRequired",
  "跟进内容摘要必填": "errors.followUpSummaryRequired",
  "跟进内容至少需要 5 个字": "errors.followUpSummaryTooShort",
  "请选择下次跟进时间": "errors.nextFollowUpRequired",
  "请你填写正确下次跟进时间！": "errors.nextFollowUpRequired",
  "请填写客户意向": "errors.customerIntentRequired",
  "下一步行动必填": "errors.nextActionRequired",
  "下一步行动至少需要 5 个字": "errors.nextActionTooShort",
  "下一步行动至少需要 10 个字": "errors.nextActionTooShort",
  "跟进时间格式无效": "errors.invalidFollowUpTime",
  "下次跟进时间格式无效": "errors.invalidNextFollowUpTime",
  "下次跟进时间格式不正确": "errors.nextFollowUpInvalid",
  "释放原因必填": "errors.releaseReasonRequired",
  "申请不存在": "errors.approvalNotFound",
  "该申请已处理，不能重复审批": "errors.approvalAlreadyProcessed",
  "客户不在公共池": "errors.publicPoolClientNotFound",
  "该客户已被其他员工领取": "errors.publicPoolClientAlreadyClaimed",
  "不能通过普通编辑将状态设为公共池，请使用释放到公共池流程":
    "errors.publicPoolRequiresReleaseFlow",
  "无法领取该客户": "errors.cannotClaimClient",
  "不能领取自己释放到公共池的客户": "errors.claimSelfReleased",
  "当前处于领取冷却期，请稍后再试": "errors.claimCooldown",
  "7 天领取名额已达上限": "errors.claimQuotaExceeded",
  "无法获取领取状态": "errors.claimStatusUnavailable",
  "缺少 jobId，请先预检": "errors.missingJobId",
  "通知不存在": "errors.notificationNotFound",
  "无权操作该通知": "errors.insufficientPermissions",
  "请先上传 CSV 或粘贴 CSV 文本": "errors.importFileRequired",
  "预检失败": "imports.precheckFailed",
  "导入失败": "errors.importFailed",
  "未授权": "errors.unauthorized",
  "权限不足": "errors.insufficientPermissions",
  "此账户已被锁定，请联系管理员处理。": "auth.accountLocked",
  "账户已被锁定，请联系管理员处理。": "auth.accountLocked",
  "客戶合併功能尚未啟用，請勿提交合併申請。": "errors.mergeCustomersDisabled",
  "客户合并功能尚未启用，请勿提交合并申请。": "errors.mergeCustomersDisabled",
};

export function resolveApiError(
  t: TranslateFn,
  input?: { error?: string; errorCode?: string; code?: string } | string | null,
): string {
  if (!input) return t("errors.saveFailed");
  if (typeof input === "string") {
    const key = CHINESE_MESSAGE_TO_KEY[input] ?? ERROR_CODE_TO_KEY[input];
    return key ? t(key) : input;
  }
  const code = input.errorCode ?? input.code;
  if (code) {
    const key = ERROR_CODE_TO_KEY[code];
    if (key) return t(key);
  }
  if (input.error) {
    const key = CHINESE_MESSAGE_TO_KEY[input.error];
    if (key) return t(key);
  }
  return input.error ?? t("errors.saveFailed");
}

export function resolveFieldError(
  t: TranslateFn,
  error: ValidationFieldError,
): string {
  if (error.code) {
    const key = FIELD_CODE_TO_KEY[error.code];
    if (key) return t(key);
  }
  const key = CHINESE_MESSAGE_TO_KEY[error.message];
  if (key) return t(key);
  return error.message;
}

export function formatHeatReasons(
  t: TranslateFn,
  keys: Array<{ key: string; params?: Record<string, string> }>,
): string {
  return keys
    .map((part) => {
      const fullKey = `heatReasons.${part.key}`;
      const translated = t(fullKey, part.params);
      return translated === fullKey ? part.key : translated;
    })
    .join(" · ");
}
