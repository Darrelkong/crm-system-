export const dynamic = "force-dynamic";

import { requireAuthCached } from "@/lib/auth/request-cache";
import { getCustomerById } from "@/lib/customers/queries";
import { getDb } from "@/lib/db";
import { listActiveCustomerTags } from "@/lib/customer-tags/queries";
import {
  canEditCustomer,
  assertCanViewCustomerFullDetails,
  PermissionError,
} from "@/lib/permissions/customers";
import { getPendingOnHoldCreateApprovalForCustomer } from "@/lib/customers/pending-on-hold-access";
import { TranslatedPageHeader } from "@/components/i18n/translated-page-header";
import { CustomerStatePanel } from "@/components/customers/customer-state-panel";
import { EditCustomerForm } from "./edit-customer-form";
import type { CustomerType, SalesStage } from "@/lib/constants/customer-fields";
import type { CustomerTagOption } from "@/lib/customer-tags/types";

type Props = { params: Promise<{ id: string }> };

export default async function EditCustomerPage({ params }: Props) {
  const { id } = await params;
  const user = await requireAuthCached();
  const customer = await getCustomerById(id);

  if (!customer) {
    return (
      <CustomerStatePanel
        titleKey="customers.notFound"
        backHref="/customers"
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

  if (!canEditCustomer(user, customer)) {
    return (
      <CustomerStatePanel
        titleKey="customers.noEditAccess"
        descriptionKey="customers.noEditAccessDetail"
        backHref={`/customers/${id}`}
        backKey="customers.backToDetails"
        variant="error"
      />
    );
  }

  try {
    assertCanViewCustomerFullDetails(user, customer);
  } catch (err) {
    if (err instanceof PermissionError) {
      return (
        <CustomerStatePanel
          titleKey="customers.noEditAccess"
          backHref={`/customers/${id}`}
          backKey="customers.backToDetails"
          variant="error"
        />
      );
    }
    throw err;
  }

  const activeTags = await listActiveCustomerTags(db);
  const tagOptions: CustomerTagOption[] = activeTags.map((tag) => ({
    tagKey: tag.tagKey,
    label: tag.label,
    isSystem: tag.isSystem,
  }));
  if (!tagOptions.some((tag) => tag.tagKey === customer.source)) {
    tagOptions.push({
      tagKey: customer.source,
      label: customer.source,
      isSystem: false,
    });
  }

  return (
    <div>
      <TranslatedPageHeader
        titleKey="customers.editClient"
        descriptionKey="customers.editingDescription"
        descriptionParams={{ name: customer.customerName }}
      />
      <EditCustomerForm
        canEditStatus={user.role === "admin"}
        isStaff={user.role !== "admin"}
        tags={tagOptions}
        initial={{
          id: customer.id,
          customerName: customer.customerName,
          customerType: customer.customerType as CustomerType,
          phoneCountryCode: customer.phoneCountryCode,
          phone: customer.phone ?? "",
          wechatId: customer.wechatId ?? "",
          email: customer.email ?? "",
          source: customer.source,
          sourceRemark: customer.sourceRemark ?? "",
          requestedProjectName: customer.requestedProjectName ?? "",
          notes: customer.notes ?? "",
          salesStage: customer.salesStage as SalesStage,
          status: customer.status,
        }}
      />
    </div>
  );
}
