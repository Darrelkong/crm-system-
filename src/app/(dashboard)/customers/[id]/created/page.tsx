export const dynamic = "force-dynamic";

import { requireAuthCached } from "@/lib/auth/request-cache";
import { getCustomerById } from "@/lib/customers/queries";
import {
  PermissionError,
  assertCanViewCustomerFullDetails,
  resolveCustomerAccessOptions,
} from "@/lib/permissions/customers";
import { getDb } from "@/lib/db";
import { getPendingOnHoldCreateApprovalForCustomer } from "@/lib/customers/pending-on-hold-access";
import { CustomerStatePanel } from "@/components/customers/customer-state-panel";
import { formatHongKongDateTime } from "@/lib/timezone";
import { CustomerCreatedClient } from "./customer-created-client";

type Props = { params: Promise<{ id: string }> };

export default async function CustomerCreatedPage({ params }: Props) {
  const { id } = await params;
  const user = await requireAuthCached();
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

  try {
    assertCanViewCustomerFullDetails(user, customer, accessOptions);
  } catch (err) {
    if (err instanceof PermissionError) {
      return (
        <CustomerStatePanel
          titleKey="errors.insufficientPermissions"
          backHref="/customers"
          backKey="customers.backToList"
          variant="error"
        />
      );
    }
    throw err;
  }

  return (
    <CustomerCreatedClient
      summary={{
        customerId: customer.id,
        customerName: customer.customerName,
        nameStatus: customer.nameStatus,
        requestedProjectCode: customer.requestedProjectCode,
        requestedProjectName: customer.requestedProjectName,
        createdAtLabel: formatHongKongDateTime(customer.createdAt),
      }}
    />
  );
}
