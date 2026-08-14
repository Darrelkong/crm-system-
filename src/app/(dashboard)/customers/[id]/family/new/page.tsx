import { notFound } from "next/navigation";
import { requireAuthCached } from "@/lib/auth/request-cache";
import { getDb } from "@/lib/db";
import { getCustomerById } from "@/lib/customers/queries";
import { canManageCustomerFamily } from "@/lib/customers/households/family-permissions";
import { listActiveCustomerTags } from "@/lib/customer-tags/queries";
import { FamilyNewCustomerClient } from "./family-new-customer-client";

type Props = {
  params: Promise<{ id: string }>;
};

export default async function FamilyNewCustomerPage({ params }: Props) {
  const user = await requireAuthCached();
  const { id } = await params;
  const db = getDb();
  const customer = await getCustomerById(id);

  if (!customer || !canManageCustomerFamily(user, customer)) {
    notFound();
  }

  const tags = await listActiveCustomerTags(db);

  return (
    <FamilyNewCustomerClient
      sourceCustomerId={id}
      sourceCustomerName={customer.customerName}
      userId={user.id}
      tags={tags.map((tag) => ({
        tagKey: tag.tagKey,
        label: tag.label,
        isSystem: tag.isSystem,
      }))}
    />
  );
}
