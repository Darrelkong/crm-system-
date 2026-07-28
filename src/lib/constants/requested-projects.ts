/**
 * Central catalog for customer requested projects (country/region two-level).
 * Groups are metadata only; selectable values are second-level items.
 * Persist `requested_project_code` + canonical `requested_project_name` (zh-Hans).
 */

export type RequestedProjectLocale = "zh-Hant" | "zh-Hans" | "en";

export type RequestedProjectGroupCode =
  | "hong_kong"
  | "united_states"
  | "singapore"
  | "united_kingdom"
  | "canada"
  | "australia"
  | "macau"
  | "uae_dubai"
  | "malaysia"
  | "other_regions"
  | "global_services"
  | "other";

export type RequestedProjectGroup = {
  groupCode: RequestedProjectGroupCode;
  labels: Record<RequestedProjectLocale, string>;
  order: number;
};

export type RequestedProjectItem = {
  code: string;
  groupCode: RequestedProjectGroupCode;
  labels: Record<RequestedProjectLocale, string>;
  canonicalZhHans: string;
  order: number;
  searchAliases?: readonly string[];
};

export const REQUESTED_PROJECT_OTHER_CODE = "other" as const;

export const REQUESTED_PROJECT_GROUPS: readonly RequestedProjectGroup[] = [
  {
    groupCode: "hong_kong",
    labels: { "zh-Hant": "香港", "zh-Hans": "香港", en: "Hong Kong" },
    order: 1,
  },
  {
    groupCode: "united_states",
    labels: { "zh-Hant": "美國", "zh-Hans": "美国", en: "United States" },
    order: 2,
  },
  {
    groupCode: "singapore",
    labels: { "zh-Hant": "新加坡", "zh-Hans": "新加坡", en: "Singapore" },
    order: 3,
  },
  {
    groupCode: "united_kingdom",
    labels: { "zh-Hant": "英國", "zh-Hans": "英国", en: "United Kingdom" },
    order: 4,
  },
  {
    groupCode: "canada",
    labels: { "zh-Hant": "加拿大", "zh-Hans": "加拿大", en: "Canada" },
    order: 5,
  },
  {
    groupCode: "australia",
    labels: { "zh-Hant": "澳洲", "zh-Hans": "澳洲", en: "Australia" },
    order: 6,
  },
  {
    groupCode: "macau",
    labels: { "zh-Hant": "澳門", "zh-Hans": "澳门", en: "Macau" },
    order: 7,
  },
  {
    groupCode: "uae_dubai",
    labels: {
      "zh-Hant": "阿聯酋（迪拜）",
      "zh-Hans": "阿联酋（迪拜）",
      en: "UAE (Dubai)",
    },
    order: 8,
  },
  {
    groupCode: "malaysia",
    labels: { "zh-Hant": "馬來西亞", "zh-Hans": "马来西亚", en: "Malaysia" },
    order: 9,
  },
  {
    groupCode: "other_regions",
    labels: {
      "zh-Hant": "其他國家／地區",
      "zh-Hans": "其他国家／地区",
      en: "Other Countries / Regions",
    },
    order: 10,
  },
  {
    groupCode: "global_services",
    labels: {
      "zh-Hant": "全球綜合服務",
      "zh-Hans": "全球综合服务",
      en: "Global Services",
    },
    order: 11,
  },
  {
    groupCode: "other",
    labels: { "zh-Hant": "其他", "zh-Hans": "其他", en: "Other" },
    order: 12,
  },
] as const;

function item(
  code: string,
  groupCode: RequestedProjectGroupCode,
  zhHant: string,
  zhHans: string,
  en: string,
  order: number,
  searchAliases?: readonly string[],
): RequestedProjectItem {
  return {
    code,
    groupCode,
    labels: { "zh-Hant": zhHant, "zh-Hans": zhHans, en },
    canonicalZhHans: zhHans,
    order,
    ...(searchAliases ? { searchAliases } : {}),
  };
}

export const REQUESTED_PROJECT_ITEMS: readonly RequestedProjectItem[] = [
  // Hong Kong
  item("hk_bank_account", "hong_kong", "香港銀行賬戶", "香港银行账户", "Hong Kong Bank Account", 1, ["銀行", "银行", "bank"]),
  item("hk_company_services", "hong_kong", "香港公司及企業服務", "香港公司及企业服务", "Hong Kong Company and Business Services", 2, ["公司", "company"]),
  item("hk_identity_planning", "hong_kong", "香港身份規劃", "香港身份规划", "Hong Kong Residency Planning", 3, ["身份", "永居", "residency"]),
  item("hk_study_services", "hong_kong", "香港留學服務", "香港留学服务", "Hong Kong Study Services", 4, ["留學", "留学", "study"]),
  item("hk_brokerage_account", "hong_kong", "香港券商賬戶", "香港券商账户", "Hong Kong Brokerage Account", 5, ["券商", "brokerage", "證券", "证券"]),

  // United States
  item("us_bank_account", "united_states", "美國銀行賬戶", "美国银行账户", "U.S. Bank Account", 6, ["銀行", "银行", "bank"]),
  item("us_credit_history", "united_states", "美國信用卡及信用記錄", "美国信用卡及信用记录", "U.S. Credit Card and Credit History", 7, ["信用卡", "信用", "credit"]),
  item("us_itin", "united_states", "美國 ITIN 稅號", "美国 ITIN 税号", "U.S. ITIN", 8, ["ITIN", "itin", "稅號", "税号"]),
  item("us_ein", "united_states", "美國 EIN 及公司稅號", "美国 EIN 及公司税号", "U.S. EIN and Business Tax ID", 9, ["EIN", "ein", "稅號", "税号"]),
  item("us_company_services", "united_states", "美國公司及企業服務", "美国公司及企业服务", "U.S. Company and Business Services", 10, ["公司", "company"]),
  item("us_immigration_planning", "united_states", "美國移民及身份規劃", "美国移民及身份规划", "U.S. Immigration and Residency Planning", 11, ["移民", "EB", "eb", "綠卡", "绿卡"]),
  item("us_study_services", "united_states", "美國留學服務", "美国留学服务", "U.S. Study Services", 12, ["留學", "留学", "study"]),
  item("us_brokerage_account", "united_states", "美國券商賬戶", "美国券商账户", "U.S. Brokerage Account", 13, ["券商", "brokerage"]),

  // Singapore
  item("sg_bank_account", "singapore", "新加坡銀行賬戶", "新加坡银行账户", "Singapore Bank Account", 14),
  item("sg_company_services", "singapore", "新加坡公司及企業服務", "新加坡公司及企业服务", "Singapore Company and Business Services", 15),
  item("sg_identity_ep", "singapore", "新加坡身份及 EP 規劃", "新加坡身份及 EP 规划", "Singapore Residency and EP Planning", 16, ["EP", "ep", "準證", "准证"]),
  item("sg_study_services", "singapore", "新加坡留學服務", "新加坡留学服务", "Singapore Study Services", 17),

  // United Kingdom
  item("uk_bank_account", "united_kingdom", "英國銀行賬戶", "英国银行账户", "United Kingdom Bank Account", 18),
  item("uk_company_services", "united_kingdom", "英國公司及企業服務", "英国公司及企业服务", "United Kingdom Company and Business Services", 19),
  item("uk_identity_visa", "united_kingdom", "英國身份及簽證規劃", "英国身份及签证规划", "United Kingdom Residency and Visa Planning", 20, ["簽證", "签证", "visa", "BNO", "bno"]),
  item("uk_study_services", "united_kingdom", "英國留學服務", "英国留学服务", "United Kingdom Study Services", 21),

  // Canada
  item("ca_bank_account", "canada", "加拿大銀行賬戶", "加拿大银行账户", "Canada Bank Account", 22),
  item("ca_company_services", "canada", "加拿大公司及企業服務", "加拿大公司及企业服务", "Canada Company and Business Services", 23),
  item("ca_immigration_planning", "canada", "加拿大身份及移民規劃", "加拿大身份及移民规划", "Canada Immigration and Residency Planning", 24, ["移民", "immigration"]),
  item("ca_study_services", "canada", "加拿大留學服務", "加拿大留学服务", "Canada Study Services", 25),

  // Australia
  item("au_bank_account", "australia", "澳洲銀行賬戶", "澳洲银行账户", "Australia Bank Account", 26),
  item("au_company_services", "australia", "澳洲公司及企業服務", "澳洲公司及企业服务", "Australia Company and Business Services", 27),
  item("au_trademark_brand", "australia", "澳洲商標及品牌服務", "澳洲商标及品牌服务", "Australia Trademark and Brand Services", 28, ["商標", "商标", "trademark", "品牌"]),
  item("au_immigration_planning", "australia", "澳洲身份及移民規劃", "澳洲身份及移民规划", "Australia Immigration and Residency Planning", 29),
  item("au_study_services", "australia", "澳洲留學服務", "澳洲留学服务", "Australia Study Services", 30),

  // Macau
  item("mo_bank_account", "macau", "澳門銀行賬戶", "澳门银行账户", "Macau Bank Account", 31),
  item("mo_company_services", "macau", "澳門公司及企業服務", "澳门公司及企业服务", "Macau Company and Business Services", 32),

  // UAE Dubai
  item("ae_bank_account", "uae_dubai", "阿聯酋銀行賬戶", "阿联酋银行账户", "United Arab Emirates Bank Account", 33, ["迪拜", "dubai", "UAE", "uae"]),
  item("ae_company_services", "uae_dubai", "阿聯酋公司及企業服務", "阿联酋公司及企业服务", "United Arab Emirates Company and Business Services", 34, ["迪拜", "dubai"]),
  item("ae_residency_visa", "uae_dubai", "阿聯酋身份及簽證規劃", "阿联酋身份及签证规划", "United Arab Emirates Residency and Visa Planning", 35, ["迪拜", "dubai"]),
  item("ae_enterprise_landing", "uae_dubai", "阿聯酋企業落地服務", "阿联酋企业落地服务", "United Arab Emirates Business Setup Services", 36, ["迪拜", "dubai", "落地"]),

  // Malaysia
  item("my_bank_account", "malaysia", "馬來西亞銀行賬戶", "马来西亚银行账户", "Malaysia Bank Account", 37),
  item("my_company_services", "malaysia", "馬來西亞公司及企業服務", "马来西亚公司及企业服务", "Malaysia Company and Business Services", 38),
  item("my_tin", "malaysia", "馬來西亞 TIN 稅號", "马来西亚 TIN 税号", "Malaysia TIN", 39, ["TIN", "tin", "稅號", "税号"]),
  item("my_work_visa_identity", "malaysia", "馬來西亞工作簽證及身份規劃", "马来西亚工作签证及身份规划", "Malaysia Work Visa and Residency Planning", 40, ["簽證", "签证", "visa"]),

  // Other regions
  item("other_overseas_bank_account", "other_regions", "其他海外銀行賬戶", "其他海外银行账户", "Other Overseas Bank Account", 41),
  item("other_overseas_company_services", "other_regions", "其他海外公司及企業服務", "其他海外公司及企业服务", "Other Overseas Company and Business Services", 42),
  item("other_overseas_identity_visa", "other_regions", "其他海外身份及簽證規劃", "其他海外身份及签证规划", "Other Overseas Residency and Visa Planning", 43),
  item("other_overseas_study_services", "other_regions", "其他海外留學服務", "其他海外留学服务", "Other Overseas Study Services", 44),
  item("other_overseas_tax_document_services", "other_regions", "其他海外稅號及文件服務", "其他海外税号及文件服务", "Other Overseas Tax ID and Document Services", 45, ["稅號", "税号"]),

  // Global services
  item("global_identity_planning", "global_services", "海外身份綜合規劃", "海外身份综合规划", "Overseas Residency Planning", 46),
  item("small_country_passport", "global_services", "小國護照及身份項目", "小国护照及身份项目", "Citizenship and Passport Programs", 47, ["護照", "护照", "passport", "公民"]),
  item("family_migration_planning", "global_services", "家庭整體移居規劃", "家庭整体移居规划", "Family Migration Planning", 48, ["家庭", "family"]),
  item("global_study_planning", "global_services", "海外留學綜合規劃", "海外留学综合规划", "Global Study Planning", 49),
  item("overseas_company_registration", "global_services", "海外公司註冊", "海外公司注册", "Overseas Company Registration", 50, ["註冊", "注册"]),
  item("enterprise_global_expansion", "global_services", "企業出海綜合服務", "企业出海综合服务", "Enterprise Global Expansion Services", 51, ["出海", "擴張", "扩张"]),
  item("odi_filing", "global_services", "ODI 境外投資備案", "ODI 境外投资备案", "ODI Overseas Investment Filing", 52, ["ODI", "odi", "備案", "备案"]),
  item("cross_border_payment_support", "global_services", "跨境收付款及賬戶配套", "跨境收付款及账户配套", "Cross-Border Payments and Account Support", 53, ["跨境", "收款", "付款", "支付"]),
  item("global_trademark_brand", "global_services", "海外商標及品牌服務", "海外商标及品牌服务", "Overseas Trademark and Brand Services", 54, ["商標", "商标"]),
  item("notarization_apostille", "global_services", "公證、海牙認證及文件配套", "公证、海牙认证及文件配套", "Notarization, Apostille and Document Services", 55, ["公證", "公证", "海牙", "apostille"]),
  item("cross_border_ecommerce", "global_services", "跨境電商綜合服務", "跨境电商综合服务", "Cross-Border E-commerce Services", 56, ["電商", "电商", "ecommerce", "e-commerce"]),
  item("amazon_ecommerce", "global_services", "Amazon 跨境電商服務", "Amazon 跨境电商服务", "Amazon Cross-Border E-commerce Services", 57, ["Amazon", "amazon", "亞馬遜", "亚马逊"]),
  item("tiktok_shop_ecommerce", "global_services", "TikTok Shop 跨境電商服務", "TikTok Shop 跨境电商服务", "TikTok Shop Cross-Border E-commerce Services", 58, ["TikTok", "tiktok", "抖音"]),
  item("shopify_ecommerce", "global_services", "Shopify 獨立站服務", "Shopify 独立站服务", "Shopify Store Services", 59, ["Shopify", "shopify", "獨立站", "独立站"]),
  item("family_trust_office", "global_services", "家族信託及家族辦公室服務", "家族信托及家族办公室服务", "Family Trust and Family Office Services", 60, ["信託", "信托", "家族", "trust"]),

  // Other (must be last)
  item(REQUESTED_PROJECT_OTHER_CODE, "other", "其他", "其他", "Other", 61),
] as const;

const GROUP_BY_CODE = new Map(
  REQUESTED_PROJECT_GROUPS.map((g) => [g.groupCode, g]),
);

const ITEM_BY_CODE = new Map(
  REQUESTED_PROJECT_ITEMS.map((i) => [i.code, i]),
);

export function getRequestedProjectGroup(
  groupCode: string,
): RequestedProjectGroup | undefined {
  return GROUP_BY_CODE.get(groupCode as RequestedProjectGroupCode);
}

export function getRequestedProjectItem(
  code: string | null | undefined,
): RequestedProjectItem | undefined {
  if (!code) return undefined;
  return ITEM_BY_CODE.get(code);
}

export function isRequestedProjectCode(
  code: string | null | undefined,
): code is string {
  return typeof code === "string" && ITEM_BY_CODE.has(code);
}

export function isRequestedProjectOtherCode(
  code: string | null | undefined,
): boolean {
  return code === REQUESTED_PROJECT_OTHER_CODE;
}

export function getRequestedProjectGroupForCode(
  code: string | null | undefined,
): RequestedProjectGroup | undefined {
  const item = getRequestedProjectItem(code);
  if (!item) return undefined;
  return getRequestedProjectGroup(item.groupCode);
}

export function getItemsForGroup(
  groupCode: RequestedProjectGroupCode,
): RequestedProjectItem[] {
  return REQUESTED_PROJECT_ITEMS.filter((i) => i.groupCode === groupCode);
}

export function getRequestedProjectLabel(
  code: string,
  locale: RequestedProjectLocale,
): string | undefined {
  return getRequestedProjectItem(code)?.labels[locale];
}

export function getRequestedProjectGroupLabel(
  groupCode: string,
  locale: RequestedProjectLocale,
): string | undefined {
  return getRequestedProjectGroup(groupCode)?.labels[locale];
}

/** Normalize query for multilingual / alias search (no UI display of codes). */
export function normalizeRequestedProjectSearchQuery(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, " ");
}

function itemMatchesQuery(
  item: RequestedProjectItem,
  group: RequestedProjectGroup | undefined,
  q: string,
): boolean {
  if (!q) return true;
  const haystacks: string[] = [
    item.code.toLowerCase(),
    item.canonicalZhHans.toLowerCase(),
    item.labels["zh-Hant"].toLowerCase(),
    item.labels["zh-Hans"].toLowerCase(),
    item.labels.en.toLowerCase(),
    ...(item.searchAliases ?? []).map((a) => a.toLowerCase()),
  ];
  if (group) {
    haystacks.push(
      group.labels["zh-Hant"].toLowerCase(),
      group.labels["zh-Hans"].toLowerCase(),
      group.labels.en.toLowerCase(),
      group.groupCode.toLowerCase(),
    );
  }
  return haystacks.some((h) => h.includes(q));
}

export type RequestedProjectSearchHit = {
  item: RequestedProjectItem;
  group: RequestedProjectGroup;
};

/** Global search across all selectable items (for level-1 search). */
export function searchRequestedProjectItems(
  query: string,
): RequestedProjectSearchHit[] {
  const q = normalizeRequestedProjectSearchQuery(query);
  if (!q) {
    return REQUESTED_PROJECT_ITEMS.map((item) => ({
      item,
      group: getRequestedProjectGroup(item.groupCode)!,
    }));
  }
  const hits: RequestedProjectSearchHit[] = [];
  for (const item of REQUESTED_PROJECT_ITEMS) {
    const group = getRequestedProjectGroup(item.groupCode)!;
    if (itemMatchesQuery(item, group, q)) {
      hits.push({ item, group });
    }
  }
  return hits;
}

/** Search within one group (for level-2 search). */
export function searchRequestedProjectItemsInGroup(
  groupCode: RequestedProjectGroupCode,
  query: string,
): RequestedProjectItem[] {
  const group = getRequestedProjectGroup(groupCode);
  const q = normalizeRequestedProjectSearchQuery(query);
  return getItemsForGroup(groupCode).filter((item) =>
    itemMatchesQuery(item, group, q),
  );
}
