export const dynamic = "force-dynamic";

import { requireAuth } from "@/lib/permissions/auth";
import { getCustomerById } from "@/lib/customers/queries";
import {
  PermissionError,
  canEditCustomer,
  canAddFollowUp,
  canReleaseToPool,
  assertCanViewFollowUps,
} from "@/lib/permissions/customers";
import { canSubmitApprovalRequest } from "@/lib/permissions/approvals";
import { enrichCustomerResponse } from "@/lib/customers/scoring/service";
import { resolveCustomerUserLabels } from "@/lib/customers/user-labels";
import { getDb } from "@/lib/db";
import { listFollowUpsByCustomerId } from "@/lib/follow-ups/queries";
import { getCustomerTimeline } from "@/lib/customers/timeline/service";
import { CustomerStatePanel } from "@/components/customers/customer-state-panel";
import { CustomerDetailClient } from "./customer-detail-client";
import { getPendingOnHoldCreateApprovalForCustomer } from "@/lib/customers/pending-on-hold-access";

type Props = { params: Promise<{ id: string }> };

export default async function CustomerDetailPage({ params }: Props) {
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
  try {
    scoresView = await enrichCustomerResponse(db, user, customer);
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
  const showFollowUpButton = canAddFollowUp(user, customer);
  const showApprovalButton = canSubmitApprovalRequest(user, customer);

  let followUps: Awaited<ReturnType<typeof listFollowUpsByCustomerId>> = [];
  try {
    assertCanViewFollowUps(user, customer);
    followUps = await listFollowUpsByCustomerId(id);
  } catch {
    // masked or denied — no follow-up list
  }

  const timeline = await getCustomerTimeline(db, user, customer);
  const userLabels = await resolveCustomerUserLabels(db, customer);

  return (
    <CustomerDetailClient
      isAdmin={user.role === "admin"}
      view={{
        id: view.id,
        customerCode: user.role === "admin" ? view.customerCode : undefined,
        customerName: view.customerName,
        customerType: view.customerType,
        salesStage: view.salesStage,
        source: view.source,
        status: view.status,
        isMasked: !!view.isMasked,
        isArchived: !!view.isArchived,
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
    />
  );
}
