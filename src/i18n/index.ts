import type { Locale } from "./config";
import { customerSourceLabelsZhCN, commonZhCN } from "./messages/zh-CN";

export type Messages = {
  common: typeof commonZhCN;
  customerSources: typeof customerSourceLabelsZhCN;
};

const catalogs: Record<Locale, Messages> = {
  "zh-CN": {
    common: commonZhCN,
    customerSources: customerSourceLabelsZhCN,
  },
  // Placeholders for later phases; fall back to zh-CN strings for now.
  "zh-TW": {
    common: commonZhCN,
    customerSources: customerSourceLabelsZhCN,
  },
  en: {
    common: commonZhCN,
    customerSources: customerSourceLabelsZhCN,
  },
};

export function getMessages(locale: Locale): Messages {
  return catalogs[locale];
}
