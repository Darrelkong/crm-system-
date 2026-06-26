export type HelpAudience = "all" | "admin";

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
};

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
    ],
  },
  {
    id: "staffGuide",
    titleKey: "help.sections.staffGuide.title",
    descriptionKey: "help.sections.staffGuide.description",
    audience: "all",
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
      "help.sections.recycleBin.items.adminRestore",
      "help.sections.recycleBin.items.autoPurge",
      "help.sections.recycleBin.items.staffNoAccess",
    ],
  },
  {
    id: "employeeMgmt",
    titleKey: "help.sections.employeeMgmt.title",
    descriptionKey: "help.sections.employeeMgmt.description",
    audience: "admin",
    itemKeys: [
      "help.sections.employeeMgmt.items.adminManage",
      "help.sections.employeeMgmt.items.softDeleteEmployee",
      "help.sections.employeeMgmt.items.deletedRecordsKept",
      "help.sections.employeeMgmt.items.deletedCannotLogin",
      "help.sections.employeeMgmt.items.customerTransfer",
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
  },
  {
    id: "accountLocked",
    questionKey: "help.faq.accountLocked.question",
    answerKey: "help.faq.accountLocked.answer",
  },
  {
    id: "deletedCustomer",
    questionKey: "help.faq.deletedCustomer.question",
    answerKey: "help.faq.deletedCustomer.answer",
  },
  {
    id: "deletedEmployeeCustomers",
    questionKey: "help.faq.deletedEmployeeCustomers.question",
    answerKey: "help.faq.deletedEmployeeCustomers.answer",
  },
  {
    id: "missingFeatures",
    questionKey: "help.faq.missingFeatures.question",
    answerKey: "help.faq.missingFeatures.answer",
  },
  {
    id: "roleDifference",
    questionKey: "help.faq.roleDifference.question",
    answerKey: "help.faq.roleDifference.answer",
  },
];

export function getHelpSectionsForRole(role: "admin" | "staff") {
  return HELP_CONTENT_SECTIONS.filter(
    (section) => section.audience === "all" || role === "admin",
  );
}
