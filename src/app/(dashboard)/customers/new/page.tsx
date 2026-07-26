import { requireAuthCached } from "@/lib/auth/request-cache";
import { getDb } from "@/lib/db";
import { listActiveCustomerTags } from "@/lib/customer-tags/queries";
import { TranslatedPageHeader } from "@/components/i18n/translated-page-header";
import { NewCustomerForm } from "./new-customer-form";

export default async function NewCustomerPage() {
  const user = await requireAuthCached();
  const db = getDb();
  const tags = await listActiveCustomerTags(db);

  return (
    <div>
      <TranslatedPageHeader
        titleKey="customers.addClient"
        descriptionKey="customers.newDescription"
      />
      <NewCustomerForm
        userId={user.id}
        tags={tags.map((tag) => ({
          tagKey: tag.tagKey,
          label: tag.label,
          isSystem: tag.isSystem,
        }))}
      />
    </div>
  );
}
