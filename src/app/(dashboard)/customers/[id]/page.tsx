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
import { getDb } from "@/lib/db";
import { listFollowUpsByCustomerId } from "@/lib/follow-ups/queries";
import { getCustomerTimeline } from "@/lib/customers/timeline/service";
import { CustomerStatePanel } from "@/components/customers/customer-state-panel";
import { CustomerDetailClient } from "./customer-detail-client";

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

  let scoresView;
  try {
    const db = getDb();
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

  const db = getDb();
  const timeline = await getCustomerTimeline(db, user, customer);

  return (
    <CustomerDetailClient
      view={{
        id: view.id,
        customerCode: view.customerCode,
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
