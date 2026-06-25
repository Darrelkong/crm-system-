import { requireAuth } from "@/lib/permissions/auth";
import { TranslatedPageHeader } from "@/components/i18n/translated-page-header";
import { NewCustomerForm } from "./new-customer-form";

export default async function NewCustomerPage() {
  await requireAuth();
  return (
    <div>
      <TranslatedPageHeader
        titleKey="customers.addClient"
        descriptionKey="customers.newDescription"
      />
      <NewCustomerForm />
    </div>
  );
}
