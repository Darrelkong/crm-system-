export const dynamic = "force-dynamic";

import { requireAuthCached } from "@/lib/auth/request-cache";
import { getCustomerById } from "@/lib/customers/queries";
import {
  PermissionError,
  canEditCustomer,
  canAddFollowUp,
  canReleaseToPool,
  assertCanViewFollowUps,
  resolveCustomerAccessOptions,
  canManageCustomerAssignees,
  canRequestCustomerAssigneeUpdate,
} from "@/lib/permissions/customers";
import { canSubmitApprovalRequest } from "@/lib/permissions/approvals";
import { enrichCustomerResponse } from "@/lib/customers/scoring/service";
import { resolveCustomerUserLabels, resolveCustomerAssigneeNames } from "@/lib/customers/user-labels";
import { getDb } from "@/lib/db";
import { listFollowUpsByCustomerId } from "@/lib/follow-ups/queries";
import { getCustomerTimeline } from "@/lib/customers/timeline/service";
import { CustomerStatePanel } from "@/components/customers/customer-state-panel";
import { CustomerDetailClient } from "./customer-detail-client";
import { getPendingOnHoldCreateApprovalForCustomer } from "@/lib/customers/pending-on-hold-access";

type Props = { params: Promise<{ id: string }> };

export default async function CustomerDetailPage({ params }: Props) {
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

  let scoresView;
  const accessOptions = await resolveCustomerAccessOptions(db, user, id);
  try {
    scoresView = await enrichCustomerResponse(
      db,
      user,
      customer,
      new Date(),
      accessOptions,
    );
  } catch (err) {
    if (err instanceof PermissionError) {
      return (
        <CustomerStatePanel
          titleKey="customers.noAccess"
          descriptionKey="customers.noAccessDetail"
          backHref="/customers"
          variant="error"
        />
      );
    }
    throw err;
  }

  const view = scoresView;
  const showEditButton = canEditCustomer(user, customer);
  const showReleaseButton = canReleaseToPool(user, customer);
  const showFollowUpButton = canAddFollowUp(user, customer, accessOptions);
  const showApprovalButton = canSubmitApprovalRequest(user, customer);
  const showManageAssigneesButton = canManageCustomerAssignees(user, customer);
  const showRequestAssigneesButton = canRequestCustomerAssigneeUpdate(
    user,
    customer,
  );
  const showLifecycleCompleteButton =
    user.role === "admin" &&
    customer.salesStage === "paid" &&
    customer.lifecycleStatus !== "completed" &&
    customer.status !== "archived" &&
    customer.status !== "public_pool" &&
    !customer.deletedAt;

  let followUps: Awaited<ReturnType<typeof listFollowUpsByCustomerId>> = [];
  try {
    assertCanViewFollowUps(user, customer, accessOptions);
    followUps = await listFollowUpsByCustomerId(id);
  } catch {
    // masked or denied — no follow-up list
  }

  const timeline = await getCustomerTimeline(db, user, customer, accessOptions);
  const userLabels = await resolveCustomerUserLabels(db, customer);
  const assigneeNames = await resolveCustomerAssigneeNames(db, id);

  return (
    <CustomerDetailClient
      isAdmin={user.role === "admin"}
      view={{
        id: view.id,
        customerCode: user.role === "admin" ? view.customerCode : undefined,
        customerName: view.customerName,
        customerType: view.customerType,
        salesStage: view.salesStage,
        lifecycleStatus: customer.lifecycleStatus,
        source: view.source,
        status: view.status,
        isMasked: !!view.isMasked,
        isArchived: !!view.isArchived,
        isPinned: view.isPinned,
        accessLevel: view.accessLevel,
        phone: view.phone,
        phoneCountryCode: view.phoneCountryCode,
        wechatId: view.wechatId,
        email: view.email,
        sourceRemark: view.sourceRemark,
        requestedProjectName: view.requestedProjectName,
        notes: view.notes,
        ownerId: view.ownerId,
        ownerName: userLabels.ownerName,
        assigneeNames,
        createdByName: userLabels.createdByName,
        lastFollowUpAt: view.lastFollowUpAt,
        lastValidFollowUpAt: view.lastValidFollowUpAt,
        neverContacted: view.neverContacted,
        nextFollowUpAt: view.nextFollowUpAt,
        overdueFollowUp: view.overdueFollowUp,
        createdAt: view.createdAt,
        updatedAt: view.updatedAt,
        heatLevel: view.heatLevel,
        completenessScore: view.completenessScore,
        heatReasonKeys: view.heatReasonKeys,
        completenessMissingFields: view.completenessMissingFields,
      }}
      followUps={followUps.map((fu) => ({
        id: fu.id,
        followUpTime: fu.followUpTime,
        channel: fu.channel,
        outcome: fu.outcome,
        isValidFollowUp: fu.isValidFollowUp,
        summary: fu.summary,
        nextFollowUpAt: fu.nextFollowUpAt,
      }))}
      timelineItems={timeline.items}
      timelineAccessLevel={timeline.accessLevel}
      showEditButton={showEditButton}
      showReleaseButton={showReleaseButton}
      showFollowUpButton={showFollowUpButton}
      showApprovalButton={showApprovalButton}
      showLifecycleCompleteButton={showLifecycleCompleteButton}
      showManageAssigneesButton={showManageAssigneesButton}
      showRequestAssigneesButton={showRequestAssigneesButton}
    />
  );
}
