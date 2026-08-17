export const dynamic = "force-dynamic";

import { requireAuthCached } from "@/lib/auth/request-cache";
import { getCustomerById } from "@/lib/customers/queries";
import { getDb } from "@/lib/db";
import {
  buildCustomerSourceMenuOptions,
  getSelectableCustomerSourceKeys,
} from "@/lib/customer-sources/keys";
import {
  getCustomerTagLabelMap,
} from "@/lib/customer-tags/queries";
import { resolveCustomerSourceDisplayLabel } from "@/lib/customer-sources/resolver";
import {
  canEditCustomer,
  assertCanViewCustomerFullDetails,
  PermissionError,
} from "@/lib/permissions/customers";
import { getPendingOnHoldCreateApprovalForCustomer } from "@/lib/customers/pending-on-hold-access";
import { CustomerStatePanel } from "@/components/customers/customer-state-panel";
import { EditCustomerForm } from "./edit-customer-form";
import { EditCustomerPageHeader } from "./edit-customer-page-header";
import type { CustomerType, SalesStage } from "@/lib/constants/customer-fields";

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

  const [sourceMenuOptions, selectableSourceKeys, labelMap] = await Promise.all([
    buildCustomerSourceMenuOptions(db),
    getSelectableCustomerSourceKeys(db),
    getCustomerTagLabelMap(db),
  ]);

  const sourceLegacyLabel = resolveCustomerSourceDisplayLabel(
    customer.source,
    labelMap,
  );

  return (
    <div>
      <EditCustomerPageHeader
        customerName={customer.customerName}
        nameStatus={customer.nameStatus}
      />
      <EditCustomerForm
        canEditStatus={user.role === "admin"}
        isStaff={user.role !== "admin"}
        sourceMenuOptions={sourceMenuOptions}
        selectableSourceKeys={selectableSourceKeys}
        sourceLegacyLabel={sourceLegacyLabel}
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
          requestedProjectCode: customer.requestedProjectCode ?? null,
          requestedProjectName: customer.requestedProjectName ?? "",
          notes: customer.notes ?? "",
          salesStage: customer.salesStage as SalesStage,
          status: customer.status,
          preferredName: customer.preferredName ?? "",
          gender: customer.gender ?? "",
          ageRange: customer.ageRange ?? "",
          preferredLanguage: customer.preferredLanguage ?? "",
          preferredContactMethod: customer.preferredContactMethod ?? "",
          occupation: customer.occupation ?? "",
          companyName: customer.companyName ?? "",
          jobTitle: customer.jobTitle ?? "",
          targetCountryOrRegion: customer.targetCountryOrRegion ?? "",
          primaryConcern: customer.primaryConcern ?? "",
        }}
      />
    </div>
  );
}
