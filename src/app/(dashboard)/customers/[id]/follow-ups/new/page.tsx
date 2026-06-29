export const dynamic = "force-dynamic";

import { requireAuth } from "@/lib/permissions/auth";
import { getCustomerById } from "@/lib/customers/queries";
import {
  canAddFollowUp,
  assertCanViewCustomerFullDetails,
  PermissionError,
  resolveCustomerAccessOptions,
} from "@/lib/permissions/customers";
import { getDb } from "@/lib/db";
import { getPendingOnHoldCreateApprovalForCustomer } from "@/lib/customers/pending-on-hold-access";
import { TranslatedPageHeader } from "@/components/i18n/translated-page-header";
import { CustomerStatePanel } from "@/components/customers/customer-state-panel";
import { NewFollowUpForm } from "./new-follow-up-form";

type Props = { params: Promise<{ id: string }> };

export default async function NewFollowUpPage({ params }: Props) {
  const { id } = await params;
  const user = await requireAuth();
  const customer = await getCustomerById(id);

  if (!customer) {
    return (
      <CustomerStatePanel
        titleKey="errors.customerNotFound"
        backHref="/customers"
        backKey="customers.backToList"
      />
    );
  }

  const db = getDb();
  const pendingOnHoldApproval = await getPendingOnHoldCreateApprovalForCustomer(
    db,
    id,
  );
  if (pendingOnHoldApproval) {
    return (
      <CustomerStatePanel
        titleKey="customers.onHoldCreatePendingTitle"
        descriptionKey="customers.onHoldCreatePendingDescription"
        backHref="/customers"
      />
    );
  }

  const accessOptions = await resolveCustomerAccessOptions(db, user, id);

  if (!canAddFollowUp(user, customer, accessOptions)) {
    return (
      <CustomerStatePanel
        titleKey="followUps.noAddPermission"
        backHref={`/customers/${id}`}
        backKey="followUps.backToDetails"
        variant="error"
      />
    );
  }

  try {
    assertCanViewCustomerFullDetails(user, customer, accessOptions);
  } catch (err) {
    if (err instanceof PermissionError) {
      return (
        <CustomerStatePanel
          titleKey="followUps.noAddPermission"
          backHref={`/customers/${id}`}
          backKey="followUps.backToDetails"
          variant="error"
        />
      );
    }
    throw err;
  }

  return (
    <div>
      <TranslatedPageHeader
        titleKey="followUps.addFollowUp"
        descriptionKey="followUps.addFollowUpDescription"
      />
      <NewFollowUpForm customerId={id} customerName={customer.customerName} />
    </div>
  );
}
