export type HelpAudience = "all" | "admin" | "staff";

export type HelpSectionConfig = {
  id: string;
  titleKey: string;
  descriptionKey: string;
  audience: HelpAudience;
  itemKeys: string[];
  /** When true, show the testing-phase badge on this section card. */
  testingPhase?: boolean;
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
    id: "aiCustomerAnalysis",
    titleKey: "help.sections.aiCustomerAnalysis.title",
    descriptionKey: "help.sections.aiCustomerAnalysis.description",
    audience: "all",
    testingPhase: true,
    itemKeys: [
      "help.sections.aiCustomerAnalysis.items.understandIntent",
      "help.sections.aiCustomerAnalysis.items.dataSources",
      "help.sections.aiCustomerAnalysis.items.nextSteps",
      "help.sections.aiCustomerAnalysis.items.assistantOnly",
      "help.sections.aiCustomerAnalysis.items.keepFollowUpsUpdated",
    ],
  },
  {
    id: "addCustomer",
    titleKey: "help.sections.addCustomer.title",
    descriptionKey: "help.sections.addCustomer.description",
    audience: "all",
    itemKeys: [
      "help.sections.addCustomer.items.basicInfo",
      "help.sections.addCustomer.items.firstContactNotes",
      "help.sections.addCustomer.items.whyNotesMatter",
      "help.sections.addCustomer.items.confirmBeforeCreate",
    ],
  },
  {
    id: "myCustomers",
    titleKey: "help.sections.myCustomers.title",
    descriptionKey: "help.sections.myCustomers.description",
    audience: "all",
    itemKeys: [
      "help.sections.myCustomers.items.list",
      "help.sections.myCustomers.items.detail",
      "help.sections.myCustomers.items.status",
      "help.sections.myCustomers.items.collaborators",
    ],
  },
  {
    id: "recordFollowUp",
    titleKey: "help.sections.recordFollowUp.title",
    descriptionKey: "help.sections.recordFollowUp.description",
    audience: "all",
    itemKeys: [
      "help.sections.recordFollowUp.items.validFollowUp",
      "help.sections.recordFollowUp.items.recordPromptly",
      "help.sections.recordFollowUp.items.invalidFollowUp",
      "help.sections.recordFollowUp.items.riskOfDelay",
    ],
  },
  {
    id: "useAiAnalysis",
    titleKey: "help.sections.useAiAnalysis.title",
    descriptionKey: "help.sections.useAiAnalysis.description",
    audience: "all",
    itemKeys: [
      "help.sections.useAiAnalysis.items.whereToFind",
      "help.sections.useAiAnalysis.items.readOutput",
      "help.sections.useAiAnalysis.items.suggestedMessage",
      "help.sections.useAiAnalysis.items.whenInaccurate",
    ],
  },
  {
    id: "avoidPublicPool",
    titleKey: "help.sections.avoidPublicPool.title",
    descriptionKey: "help.sections.avoidPublicPool.description",
    audience: "all",
    itemKeys: [
      "help.sections.avoidPublicPool.items.followOnTime",
      "help.sections.avoidPublicPool.items.validRecords",
      "help.sections.avoidPublicPool.items.watchReminders",
      "help.sections.avoidPublicPool.items.collaborativeCustomers",
    ],
  },
  {
    id: "claimFromPool",
    titleKey: "help.sections.claimFromPool.title",
    descriptionKey: "help.sections.claimFromPool.description",
    audience: "all",
    itemKeys: [
      "help.sections.claimFromPool.items.whatIsPool",
      "help.sections.claimFromPool.items.whyEnterPool",
      "help.sections.claimFromPool.items.howToClaim",
      "help.sections.claimFromPool.items.followUpAfterClaim",
    ],
  },
  {
    id: "announcements",
    titleKey: "help.sections.announcements.title",
    descriptionKey: "help.sections.announcements.description",
    audience: "all",
    itemKeys: [
      "help.sections.announcements.items.welcomePage",
      "help.sections.announcements.items.latestAnnouncement",
      "help.sections.announcements.items.confirmThenEnter",
      "help.sections.announcements.items.staffCountdown",
    ],
  },
  {
    id: "approvals",
    titleKey: "help.sections.approvals.title",
    descriptionKey: "help.sections.approvals.description",
    audience: "all",
    itemKeys: [
      "help.sections.approvals.items.whatToSubmit",
      "help.sections.approvals.items.checkStatus",
      "help.sections.approvals.items.navBadge",
      "help.sections.approvals.items.collaboratorRequest",
    ],
  },
];

export const HELP_FAQ_ITEMS: HelpFaqItem[] = [
  {
    id: "cannotSeeCustomer",
    questionKey: "help.faq.cannotSeeCustomer.question",
    answerKey: "help.faq.cannotSeeCustomer.answer",
    audience: "all",
  },
  {
    id: "customerInPublicPool",
    questionKey: "help.faq.customerInPublicPool.question",
    answerKey: "help.faq.customerInPublicPool.answer",
    audience: "all",
  },
  {
    id: "aiAnalysisIncomplete",
    questionKey: "help.faq.aiAnalysisIncomplete.question",
    answerKey: "help.faq.aiAnalysisIncomplete.answer",
    audience: "all",
  },
  {
    id: "whyRecordFollowUp",
    questionKey: "help.faq.whyRecordFollowUp.question",
    answerKey: "help.faq.whyRecordFollowUp.answer",
    audience: "all",
  },
  {
    id: "welcomePageFirst",
    questionKey: "help.faq.welcomePageFirst.question",
    answerKey: "help.faq.welcomePageFirst.answer",
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
    id: "cannotClaimPool",
    questionKey: "help.faq.cannotClaimPool.question",
    answerKey: "help.faq.cannotClaimPool.answer",
    audience: "staff",
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
