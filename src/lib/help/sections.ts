export type HelpAudience = "all" | "admin" | "staff";

export type HelpSectionConfig = {
  id: string;
  titleKey: string;
  descriptionKey: string;
  audience: HelpAudience;
  itemKeys: string[];
};

export type HelpFaqItem = {
  id: string;
  questionKey: string;
  answerKey: string;
  audience: HelpAudience;
};

export function isHelpVisibleForRole(
  audience: HelpAudience,
  role: "admin" | "staff",
): boolean {
  if (audience === "all") return true;
  if (audience === "admin") return role === "admin";
  return role === "staff";
}

export const HELP_CONTENT_SECTIONS: HelpSectionConfig[] = [
  {
    id: "adminGuide",
    titleKey: "help.sections.adminGuide.title",
    descriptionKey: "help.sections.adminGuide.description",
    audience: "admin",
    itemKeys: [
      "help.sections.adminGuide.items.dashboard",
      "help.sections.adminGuide.items.manageCustomers",
      "help.sections.adminGuide.items.addCustomer",
      "help.sections.adminGuide.items.manageEmployees",
      "help.sections.adminGuide.items.loginLogs",
      "help.sections.adminGuide.items.notificationsAnnouncements",
      "help.sections.adminGuide.items.securityPolicies",
      "help.sections.adminGuide.items.systemSettings",
    ],
  },
  {
    id: "adminWorkspace",
    titleKey: "help.sections.adminWorkspace.title",
    descriptionKey: "help.sections.adminWorkspace.description",
    audience: "admin",
    itemKeys: [
      "help.sections.adminWorkspace.items.dashboardKpi",
      "help.sections.adminWorkspace.items.workflowPriorities",
      "help.sections.adminWorkspace.items.notifications",
      "help.sections.adminWorkspace.items.announcements",
      "help.sections.adminWorkspace.items.systemOnline",
    ],
  },
  {
    id: "adminSensitiveAssignees",
    titleKey: "help.sections.adminSensitiveAssignees.title",
    descriptionKey: "help.sections.adminSensitiveAssignees.description",
    audience: "admin",
    itemKeys: [
      "help.sections.adminSensitiveAssignees.items.editSensitive",
      "help.sections.adminSensitiveAssignees.items.manageAssignees",
      "help.sections.adminSensitiveAssignees.items.approveAssigneeRequests",
      "help.sections.adminSensitiveAssignees.items.collaboratorLimits",
    ],
  },
  {
    id: "staffGuide",
    titleKey: "help.sections.staffGuide.title",
    descriptionKey: "help.sections.staffGuide.description",
    audience: "staff",
    itemKeys: [
      "help.sections.staffGuide.items.viewCustomers",
      "help.sections.staffGuide.items.addCustomer",
      "help.sections.staffGuide.items.updateCustomer",
      "help.sections.staffGuide.items.addFollowUp",
      "help.sections.staffGuide.items.notifications",
      "help.sections.staffGuide.items.announcements",
    ],
  },
  {
    id: "staffDashboard",
    titleKey: "help.sections.staffDashboard.title",
    descriptionKey: "help.sections.staffDashboard.description",
    audience: "staff",
    itemKeys: [
      "help.sections.staffDashboard.items.myClients",
      "help.sections.staffDashboard.items.tasks",
      "help.sections.staffDashboard.items.approvals",
      "help.sections.staffDashboard.items.riskAndCompleteness",
      "help.sections.staffDashboard.items.recentCards",
    ],
  },
  {
    id: "sensitiveDataStaff",
    titleKey: "help.sections.sensitiveDataStaff.title",
    descriptionKey: "help.sections.sensitiveDataStaff.description",
    audience: "staff",
    itemKeys: [
      "help.sections.sensitiveDataStaff.items.createConfirm",
      "help.sections.sensitiveDataStaff.items.lockedFields",
      "help.sections.sensitiveDataStaff.items.contactMasking",
      "help.sections.sensitiveDataStaff.items.noCustomerCode",
    ],
  },
  {
    id: "publicPoolStaff",
    titleKey: "help.sections.publicPoolStaff.title",
    descriptionKey: "help.sections.publicPoolStaff.description",
    audience: "staff",
    itemKeys: [
      "help.sections.publicPoolStaff.items.nameMasking",
      "help.sections.publicPoolStaff.items.listColumns",
      "help.sections.publicPoolStaff.items.poolReasonPreview",
      "help.sections.publicPoolStaff.items.claimSuccess",
      "help.sections.publicPoolStaff.items.quotaCooldown",
    ],
  },
  {
    id: "publicPoolAdmin",
    titleKey: "help.sections.publicPoolAdmin.title",
    descriptionKey: "help.sections.publicPoolAdmin.description",
    audience: "admin",
    itemKeys: [
      "help.sections.publicPoolAdmin.items.fullName",
      "help.sections.publicPoolAdmin.items.contactColumn",
      "help.sections.publicPoolAdmin.items.claimSuccess",
      "help.sections.publicPoolAdmin.items.poolSettings",
    ],
  },
  {
    id: "collaboratorsStaff",
    titleKey: "help.sections.collaboratorsStaff.title",
    descriptionKey: "help.sections.collaboratorsStaff.description",
    audience: "staff",
    itemKeys: [
      "help.sections.collaboratorsStaff.items.ownerRequest",
      "help.sections.collaboratorsStaff.items.collaboratorRole",
      "help.sections.collaboratorsStaff.items.adminOnlyManage",
    ],
  },
  {
    id: "followUpRules",
    titleKey: "help.sections.followUpRules.title",
    descriptionKey: "help.sections.followUpRules.description",
    audience: "all",
    itemKeys: [
      "help.sections.followUpRules.items.nextFollowUpRequired",
      "help.sections.followUpRules.items.customerIntentRequired",
      "help.sections.followUpRules.items.nextActionMinLength",
      "help.sections.followUpRules.items.validFollowUpImpact",
    ],
  },
  {
    id: "customerFlow",
    titleKey: "help.sections.customerFlow.title",
    descriptionKey: "help.sections.customerFlow.description",
    audience: "all",
    itemKeys: [
      "help.sections.customerFlow.items.addCustomer",
      "help.sections.customerFlow.items.assignOwner",
      "help.sections.customerFlow.items.updateStatusStage",
      "help.sections.customerFlow.items.addFollowUp",
      "help.sections.customerFlow.items.timeline",
      "help.sections.customerFlow.items.aiInsight",
    ],
  },
  {
    id: "recycleBin",
    titleKey: "help.sections.recycleBin.title",
    descriptionKey: "help.sections.recycleBin.description",
    audience: "all",
    itemKeys: [
      "help.sections.recycleBin.items.softDelete",
      "help.sections.recycleBin.items.retention",
      "help.sections.recycleBin.items.staffNoAccess",
    ],
  },
  {
    id: "recycleBinAdmin",
    titleKey: "help.sections.recycleBinAdmin.title",
    descriptionKey: "help.sections.recycleBinAdmin.description",
    audience: "admin",
    itemKeys: [
      "help.sections.recycleBinAdmin.items.adminRestore",
      "help.sections.recycleBinAdmin.items.permanentDelete",
      "help.sections.recycleBinAdmin.items.autoPurge",
    ],
  },
  {
    id: "employeeMgmt",
    titleKey: "help.sections.employeeMgmt.title",
    descriptionKey: "help.sections.employeeMgmt.description",
    audience: "admin",
    itemKeys: [
      "help.sections.employeeMgmt.items.adminManage",
      "help.sections.employeeMgmt.items.deletePreview",
      "help.sections.employeeMgmt.items.softDeleteEmployee",
      "help.sections.employeeMgmt.items.deletedRecordsKept",
      "help.sections.employeeMgmt.items.deletedCannotLogin",
      "help.sections.employeeMgmt.items.customerTransfer",
    ],
  },
  {
    id: "autoReclaimSettings",
    titleKey: "help.sections.autoReclaimSettings.title",
    descriptionKey: "help.sections.autoReclaimSettings.description",
    audience: "admin",
    itemKeys: [
      "help.sections.autoReclaimSettings.items.reclaimDays",
      "help.sections.autoReclaimSettings.items.warningDays",
      "help.sections.autoReclaimSettings.items.onHoldPinned",
      "help.sections.autoReclaimSettings.items.settingsPath",
    ],
  },
  {
    id: "loginSecurity",
    titleKey: "help.sections.loginSecurity.title",
    descriptionKey: "help.sections.loginSecurity.description",
    audience: "all",
    itemKeys: [
      "help.sections.loginSecurity.items.staffLockout",
      "help.sections.loginSecurity.items.lockedCannotLogin",
      "help.sections.loginSecurity.items.adminExempt",
      "help.sections.loginSecurity.items.adminUnlock",
      "help.sections.loginSecurity.items.inactivityLogout",
      "help.sections.loginSecurity.items.timeoutReverify",
    ],
  },
];

export const HELP_FAQ_ITEMS: HelpFaqItem[] = [
  {
    id: "autoLogout",
    questionKey: "help.faq.autoLogout.question",
    answerKey: "help.faq.autoLogout.answer",
    audience: "all",
  },
  {
    id: "accountLocked",
    questionKey: "help.faq.accountLocked.question",
    answerKey: "help.faq.accountLocked.answer",
    audience: "all",
  },
  {
    id: "missingFeatures",
    questionKey: "help.faq.missingFeatures.question",
    answerKey: "help.faq.missingFeatures.answer",
    audience: "all",
  },
  {
    id: "roleDifference",
    questionKey: "help.faq.roleDifference.question",
    answerKey: "help.faq.roleDifference.answer",
    audience: "all",
  },
  {
    id: "followUpRequired",
    questionKey: "help.faq.followUpRequired.question",
    answerKey: "help.faq.followUpRequired.answer",
    audience: "all",
  },
  {
    id: "createConfirmWait",
    questionKey: "help.faq.createConfirmWait.question",
    answerKey: "help.faq.createConfirmWait.answer",
    audience: "staff",
  },
  {
    id: "sensitiveLocked",
    questionKey: "help.faq.sensitiveLocked.question",
    answerKey: "help.faq.sensitiveLocked.answer",
    audience: "staff",
  },
  {
    id: "publicPoolNameMask",
    questionKey: "help.faq.publicPoolNameMask.question",
    answerKey: "help.faq.publicPoolNameMask.answer",
    audience: "staff",
  },
  {
    id: "cannotClaimPool",
    questionKey: "help.faq.cannotClaimPool.question",
    answerKey: "help.faq.cannotClaimPool.answer",
    audience: "staff",
  },
  {
    id: "deletedCustomer",
    questionKey: "help.faq.deletedCustomer.question",
    answerKey: "help.faq.deletedCustomer.answer",
    audience: "admin",
  },
  {
    id: "deletedEmployeeCustomers",
    questionKey: "help.faq.deletedEmployeeCustomers.question",
    answerKey: "help.faq.deletedEmployeeCustomers.answer",
    audience: "admin",
  },
  {
    id: "permanentDelete",
    questionKey: "help.faq.permanentDelete.question",
    answerKey: "help.faq.permanentDelete.answer",
    audience: "admin",
  },
  {
    id: "autoReclaim",
    questionKey: "help.faq.autoReclaim.question",
    answerKey: "help.faq.autoReclaim.answer",
    audience: "admin",
  },
  {
    id: "assigneeApproval",
    questionKey: "help.faq.assigneeApproval.question",
    answerKey: "help.faq.assigneeApproval.answer",
    audience: "admin",
  },
];

export function getHelpSectionsForRole(role: "admin" | "staff") {
  return HELP_CONTENT_SECTIONS.filter((section) =>
    isHelpVisibleForRole(section.audience, role),
  );
}

export function getHelpFaqForRole(role: "admin" | "staff") {
  return HELP_FAQ_ITEMS.filter((item) =>
    isHelpVisibleForRole(item.audience, role),
  );
}
