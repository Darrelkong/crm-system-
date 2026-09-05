import { requireAuthCached } from "@/lib/auth/request-cache";
import { getDb } from "@/lib/db";
import { listActiveStaffUsers } from "@/lib/users/queries";
import {
  buildCustomerSourceMenuOptions,
  getSelectableCustomerSourceKeys,
} from "@/lib/customer-sources/keys";
import { TranslatedPageHeader } from "@/components/i18n/translated-page-header";
import { NewCustomerForm } from "./new-customer-form";

export default async function NewCustomerPage() {
  const user = await requireAuthCached();
  const db = getDb();
  const [sourceMenuOptions, selectableSourceKeys, ownerOptions] = await Promise.all([
    buildCustomerSourceMenuOptions(db),
    getSelectableCustomerSourceKeys(db),
    user.role === "admin"
      ? listActiveStaffUsers().then((users) =>
          users.map(({ id, displayName }) => ({ id, displayName })),
        )
      : Promise.resolve([]),
  ]);

  return (
    <div>
      <TranslatedPageHeader
        titleKey="customers.addClient"
        descriptionKey="customers.newDescription"
      />
      <NewCustomerForm
        userId={user.id}
        ownerOptions={ownerOptions}
        sourceMenuOptions={sourceMenuOptions}
        selectableSourceKeys={selectableSourceKeys}
      />
    </div>
  );
}
