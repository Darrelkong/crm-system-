export const dynamic = "force-dynamic";

import { requireAuth } from "@/lib/permissions/auth";
import { getCustomerById } from "@/lib/customers/queries";
import {
  canEditCustomer,
  assertCanViewCustomerFullDetails,
  PermissionError,
} from "@/lib/permissions/customers";
import { TranslatedPageHeader } from "@/components/i18n/translated-page-header";
import { CustomerStatePanel } from "@/components/customers/customer-state-panel";
import { EditCustomerForm } from "./edit-customer-form";
import type { CustomerSourceKey } from "@/lib/constants/customer-sources";
import type { CustomerType, SalesStage } from "@/lib/constants/customer-fields";

type Props = { params: Promise<{ id: string }> };

export default async function EditCustomerPage({ params }: Props) {
  const { id } = await params;
  const user = await requireAuth();
  const customer = await getCustomerById(id);

  if (!customer) {
    return (
      <CustomerStatePanel
        titleKey="customers.notFound"
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

  return (
    <div>
      <TranslatedPageHeader
        titleKey="customers.editClient"
        descriptionKey="customers.editingDescription"
        descriptionParams={{ name: customer.customerName }}
      />
      <EditCustomerForm
        canEditStatus={user.role === "admin"}
        initial={{
          id: customer.id,
          customerName: customer.customerName,
          customerType: customer.customerType as CustomerType,
          phoneCountryCode: customer.phoneCountryCode,
          phone: customer.phone ?? "",
          wechatId: customer.wechatId ?? "",
          email: customer.email ?? "",
          source: customer.source as CustomerSourceKey,
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
