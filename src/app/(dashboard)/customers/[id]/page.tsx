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
  isStaffUnclaimedPublicPoolCustomer,
} from "@/lib/permissions/customers";
import { canConfirmPendingCustomerName } from "@/lib/customers/confirm-name";
import { canSubmitApprovalRequest } from "@/lib/permissions/approvals";
import { enrichCustomerResponse } from "@/lib/customers/scoring/service";
import { resolveCustomerUserLabels, resolveCustomerAssigneeNames } from "@/lib/customers/user-labels";
import { getDb } from "@/lib/db";
import { listFollowUpsByCustomerId } from "@/lib/follow-ups/queries";
import { getCustomerTimeline, assertCanViewCustomerTimeline } from "@/lib/customers/timeline/service";
import { CustomerStatePanel } from "@/components/customers/customer-state-panel";
import { CustomerDetailClient } from "./customer-detail-client";
import { getPendingOnHoldCreateApprovalForCustomer } from "@/lib/customers/pending-on-hold-access";
import { parseSafeFollowUpsReturnTo } from "@/lib/follow-ups/safe-return-to";
import { parseSafeWorkItemsReturnTo } from "@/lib/work-items/safe-return-to";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

function firstSearchParam(
  value: string | string[] | undefined,
): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return undefined;
}

export default async function CustomerDetailPage({ params, searchParams }: Props) {
  const { id } = await params;
  const query = await searchParams;
  const returnToRaw = firstSearchParam(query.returnTo);
  const safeReturnHref =
    parseSafeWorkItemsReturnTo(returnToRaw) ??
    parseSafeFollowUpsReturnTo(returnToRaw) ??
    "/customers";
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

  if (isStaffUnclaimedPublicPoolCustomer(user, customer)) {
    return (
      <CustomerStatePanel
        titleKey="publicPool.detailDeniedTitle"
        descriptionKey="publicPool.detailDeniedDescription"
        backHref="/public-pool"
        backKey="publicPool.backToPool"
        variant="error"
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

  let sharedFollowUpsPromise: ReturnType<typeof listFollowUpsByCustomerId> =
    Promise.resolve([]);
  let shouldPreloadFollowUpsForTimeline = false;
  try {
    assertCanViewCustomerTimeline(user, customer, accessOptions);
    shouldPreloadFollowUpsForTimeline = true;
    sharedFollowUpsPromise = listFollowUpsByCustomerId(id);
  } catch {
    // timeline access denied; getCustomerTimeline will throw
  }

  const followUpsForClientPromise = (async () => {
    try {
      assertCanViewFollowUps(user, customer, accessOptions);
      return await sharedFollowUpsPromise;
    } catch {
      return [];
    }
  })();

  const timelinePromise = (async () => {
    const preloadedFollowUps = shouldPreloadFollowUpsForTimeline
      ? await sharedFollowUpsPromise
      : undefined;
    return getCustomerTimeline(db, user, customer, accessOptions, {
      preloadedFollowUps,
    });
  })();

  const [
    showConfirmNameButton,
    followUps,
    timeline,
    userLabels,
    assigneeNames,
  ] = await Promise.all([
    canConfirmPendingCustomerName(db, user, customer),
    followUpsForClientPromise,
    timelinePromise,
    resolveCustomerUserLabels(db, customer),
    resolveCustomerAssigneeNames(db, id),
  ]);

  return (
    <CustomerDetailClient
      isAdmin={user.role === "admin"}
      view={{
        id: view.id,
        customerCode: user.role === "admin" ? view.customerCode : undefined,
        customerName: view.customerName,
        nameStatus: view.nameStatus,
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
        requestedProjectCode: view.requestedProjectCode,
        requestedProjectName: view.requestedProjectName,
        notes: view.notes,
        preferredName: view.preferredName,
        gender: view.gender,
        ageRange: view.ageRange,
        preferredLanguage: view.preferredLanguage,
        preferredContactMethod: view.preferredContactMethod,
        occupation: view.occupation,
        companyName: view.companyName,
        jobTitle: view.jobTitle,
        targetCountryOrRegion: view.targetCountryOrRegion,
        primaryConcern: view.primaryConcern,
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
      showConfirmNameButton={showConfirmNameButton}
      showManageAssigneesButton={showManageAssigneesButton}
      showRequestAssigneesButton={showRequestAssigneesButton}
      returnHref={safeReturnHref}
    />
  );
}
