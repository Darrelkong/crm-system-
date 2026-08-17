import { requireAuthCached } from "@/lib/auth/request-cache";
import { getDb } from "@/lib/db";
import {
  buildCustomerSourceMenuOptions,
  getSelectableCustomerSourceKeys,
} from "@/lib/customer-sources/keys";
import { TranslatedPageHeader } from "@/components/i18n/translated-page-header";
import { NewCustomerForm } from "./new-customer-form";

export default async function NewCustomerPage() {
  const user = await requireAuthCached();
  const db = getDb();
  const [sourceMenuOptions, selectableSourceKeys] = await Promise.all([
    buildCustomerSourceMenuOptions(db),
    getSelectableCustomerSourceKeys(db),
  ]);

  return (
    <div>
      <TranslatedPageHeader
        titleKey="customers.addClient"
        descriptionKey="customers.newDescription"
      />
      <NewCustomerForm
        userId={user.id}
        sourceMenuOptions={sourceMenuOptions}
        selectableSourceKeys={selectableSourceKeys}
      />
    </div>
  );
}
