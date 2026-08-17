import { getDb } from "@/lib/db";
import { getSelectableCustomerSourceKeys } from "@/lib/customer-sources/keys";
import { ImportCustomersPageClient } from "./import-customers-page-client";

export default async function ImportCustomersPage() {
  const db = getDb();
  const selectableSourceKeys = await getSelectableCustomerSourceKeys(db);

  return (
    <ImportCustomersPageClient
      selectableSourceKeys={selectableSourceKeys}
    />
  );
}
