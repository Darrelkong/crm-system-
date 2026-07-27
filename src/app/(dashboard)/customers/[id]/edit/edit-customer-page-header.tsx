"use client";

import { TranslatedPageHeader } from "@/components/i18n/translated-page-header";
import { useTranslation } from "@/i18n/provider";
import { getCustomerDisplayName } from "@/lib/customers/customer-display-name";

export function EditCustomerPageHeader({
  customerName,
  nameStatus,
}: {
  customerName: string;
  nameStatus?: string;
}) {
  const { locale } = useTranslation();
  const displayName = getCustomerDisplayName({
    customerName,
    nameStatus,
    locale,
  });

  return (
    <TranslatedPageHeader
      titleKey="customers.editClient"
      descriptionKey="customers.editingDescription"
      descriptionParams={{ name: displayName }}
    />
  );
}
