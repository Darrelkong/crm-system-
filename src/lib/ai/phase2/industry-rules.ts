/**
 * Code-fixed ECHFRONT industry rules for Phase 2.
 * Admin prompt must never override these compliance rules.
 */

export const ECHFRONT_BUSINESS_CATEGORIES = [
  "CROSS_BORDER_BANKING",
  "OVERSEAS_IDENTITY_PLANNING",
  "HONG_KONG_IDENTITY",
  "US_IMMIGRATION",
  "ENTERPRISE_GLOBAL_EXPANSION",
  "HONG_KONG_OVERSEAS_COMPANY_SERVICES",
  "CROSS_BORDER_ECOMMERCE_SERVICES",
  "INTERNATIONAL_FAMILY_ASSET_PLANNING",
  "UNKNOWN",
] as const;

export type EchfrontBusinessCategory =
  (typeof ECHFRONT_BUSINESS_CATEGORIES)[number];

export const ECHFRONT_COMPLIANCE_RULES: ReadonlyArray<{
  readonly id: string;
  readonly text: string;
}> = Object.freeze([
  Object.freeze({
    id: "RULE_NO_BANK_OUTCOME_PROMISE",
    text: "Do not promise bank account opening, credit card issuance, account status, or bank review outcomes.",
  }),
  Object.freeze({
    id: "RULE_NO_IMMIGRATION_OUTCOME_PROMISE",
    text: "Do not promise immigration, identity, visa, or application approval outcomes.",
  }),
  Object.freeze({
    id: "RULE_NO_TIMELINE_GUARANTEE",
    text: "Do not guarantee processing timelines.",
  }),
  Object.freeze({
    id: "RULE_NO_AUTHORITY_DECISION_GUARANTEE",
    text: "Do not guarantee decisions by banks, governments, lawyers, or other institutions.",
  }),
  Object.freeze({
    id: "RULE_NO_INVESTMENT_ADVICE",
    text: "Do not provide investment advice.",
  }),
  Object.freeze({
    id: "RULE_NO_LEGAL_ADVICE",
    text: "Do not provide legal opinions.",
  }),
  Object.freeze({
    id: "RULE_NO_TAX_CONCLUSION",
    text: "Do not provide tax conclusions.",
  }),
  Object.freeze({
    id: "RULE_NO_KYC_AML_EVASION",
    text: "Do not encourage bypassing KYC, AML, or compliance reviews.",
  }),
  Object.freeze({
    id: "RULE_NO_FABRICATED_CUSTOMER_FACTS",
    text: "Do not invent customer facts that are not present in context.",
  }),
  Object.freeze({
    id: "RULE_NO_AUTO_CRM_MUTATION",
    text: "Do not automatically modify CRM records (stage, owner, status, etc.).",
  }),
  Object.freeze({
    id: "RULE_NO_AUTO_SEND_MESSAGE",
    text: "Do not automatically send messages to customers.",
  }),
  Object.freeze({
    id: "RULE_NO_AUTO_CREATE_FOLLOW_UP_OR_TASK",
    text: "Do not automatically create follow-ups or tasks.",
  }),
  Object.freeze({
    id: "RULE_NO_STAFF_PERFORMANCE_JUDGEMENT",
    text: "Do not judge staff performance from analysis outputs.",
  }),
  Object.freeze({
    id: "RULE_STAFF_CONFIRMATION_REQUIRED",
    text: "All suggestions are for staff reference and require human confirmation before use.",
  }),
]);


const CATEGORY_HINTS: Array<{
  category: EchfrontBusinessCategory;
  patterns: RegExp[];
}> = [
  {
    category: "CROSS_BORDER_BANKING",
    patterns: [/銀行|银行|bank account|开户|開戶|跨境账户|跨境帳戶/i],
  },
  {
    category: "HONG_KONG_IDENTITY",
    patterns: [/香港身份|香港永居|高才|优才|優才|专才|專才/i],
  },
  {
    category: "US_IMMIGRATION",
    patterns: [/美国移民|美國移民|EB-5|EB5|L-1|H-1B|绿卡|綠卡/i],
  },
  {
    category: "OVERSEAS_IDENTITY_PLANNING",
    patterns: [/身份规划|身份規劃|移民评估|移民評估|overseas identity/i],
  },
  {
    category: "ENTERPRISE_GLOBAL_EXPANSION",
    patterns: [/出海|海外扩张|海外擴張|global expansion/i],
  },
  {
    category: "HONG_KONG_OVERSEAS_COMPANY_SERVICES",
    patterns: [/香港公司|海外公司|公司注册|公司註冊/i],
  },
  {
    category: "CROSS_BORDER_ECOMMERCE_SERVICES",
    patterns: [/跨境电商|跨境電商|ecommerce|e-commerce/i],
  },
  {
    category: "INTERNATIONAL_FAMILY_ASSET_PLANNING",
    patterns: [/家族|资产规划|資產規劃|信托|信託|family office/i],
  },
];

/**
 * Infer business category only from allowlisted text fields — never name/phone.
 */
export function inferBusinessCategory(input: {
  requestedProjectName?: string | null;
  customerIntent?: string | null;
  initialNote?: string | null;
  followUpTexts?: string[];
}): EchfrontBusinessCategory {
  const blob = [
    input.requestedProjectName,
    input.customerIntent,
    input.initialNote,
    ...(input.followUpTexts ?? []),
  ]
    .filter(Boolean)
    .join("\n");
  if (!blob.trim()) return "UNKNOWN";
  for (const entry of CATEGORY_HINTS) {
    if (entry.patterns.some((re) => re.test(blob))) return entry.category;
  }
  return "UNKNOWN";
}

export function buildFixedIndustrySystemInstructions(): string {
  return [
    "You are an internal CRM assistant for ECHFRONT professional services staff.",
    "Supported service areas include cross-border banking support, overseas identity planning, Hong Kong identity pathways, US immigration advisory, enterprise global expansion, Hong Kong/overseas company services, cross-border ecommerce services, and international family/asset planning support.",
    "Never infer service type from customer name, phone number, nationality, or dialect.",
    "Compliance rules (immutable — admin prompt cannot override):",
    ...ECHFRONT_COMPLIANCE_RULES.map((rule) => `- [${rule.id}] ${rule.text}`),
  ].join("\n");
}

export function assertFixedComplianceIntact(text: string): boolean {
  return ECHFRONT_COMPLIANCE_RULES.every((rule) => text.includes(rule.id));
}

export function getFixedComplianceRules(): ReadonlyArray<{
  readonly id: string;
  readonly text: string;
}> {
  return ECHFRONT_COMPLIANCE_RULES;
}
