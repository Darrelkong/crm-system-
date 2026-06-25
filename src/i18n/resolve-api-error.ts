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
  SESSION_IDLE_EXPIRED: "security.sessionTimedOutReLogin",
  SESSION_REVOKED: "security.sessionRevokedByOtherDevice",
  SESSION_INVALID: "security.sessionInvalidReLogin",
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
  "permission.denied.follow_up_access": "errors.cannotAddFollowUp",
  "permission.denied.customer_timeline_access": "errors.cannotViewTimeline",
  "customer.release_to_pool_failed.permission_denied": "errors.cannotReleaseCustomer",
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
  INVALID_STATUS: "errors.invalidStatus",
  FOLLOW_UP_CHANNEL_REQUIRED: "errors.followUpChannelRequired",
  FOLLOW_UP_OUTCOME_REQUIRED: "errors.followUpOutcomeRequired",
  FOLLOW_UP_SUMMARY_REQUIRED: "errors.followUpSummaryRequired",
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
  "跟进时间格式无效": "errors.invalidFollowUpTime",
  "下次跟进时间格式无效": "errors.invalidNextFollowUpTime",
  "释放原因必填": "errors.releaseReasonRequired",
  "申请不存在": "errors.approvalNotFound",
  "该申请已处理，不能重复审批": "errors.approvalAlreadyProcessed",
  "客户不在公共池": "errors.publicPoolClientNotFound",
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
