"use client";

import { useCallback } from "react";
import { useTranslation } from "@/i18n/provider";
import type { CustomerType } from "@/lib/constants/customer-fields";
import type { HeatLevel } from "@/lib/customers/scoring/types";

export function useCustomerLabels() {
  const { t } = useTranslation();

  const label = useCallback(
    (prefix: string, key: string) => {
      const full = `${prefix}.${key}`;
      const value = t(full);
      return value === full ? key : value;
    },
    [t],
  );

  return {
    t,
    source: (key: string) => label("customerSources", key),
    salesStage: (key: string) => label("salesStages", key),
    heatLevel: (key: HeatLevel) => label("heatLevels", key),
    status: (key: string) => label("customerStatuses", key),
    customerType: (key: CustomerType | string) => {
      if (key === "individual") return t("customers.individual");
      if (key === "company") return t("customers.company");
      return key;
    },
    completenessField: (key: string) => label("completenessFields", key),
    approvalType: (key: string) => label("customers.approvalTypes", key),
    approvalStatus: (key: string) => label("approvalStatuses", key),
    followUpChannel: (key: string) => label("followUpChannels", key),
    followUpOutcome: (key: string) => label("followUpOutcomes", key),
    timelineType: (key: string) => label("timelineTypes", key),
    fieldLabel: (field: string) => {
      if (field === "phone") return t("customers.phone");
      if (field === "wechatId") return t("customers.wechatId");
      if (field === "email") return t("common.email");
      return field;
    },
  };
}
