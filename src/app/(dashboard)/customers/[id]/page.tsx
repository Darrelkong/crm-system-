export const dynamic = "force-dynamic";

import { requireAuthCached } from "@/lib/auth/request-cache";
import { getCustomerById } from "@/lib/customers/queries";
import {
  PermissionError,
  canEditCustomer,
  canAddFollowUp,
  canReleaseToPool,
  assertCanViewFollowUps,
  resolveCustomerAccessOptionsFromAssignees,
  canManageCustomerAssignees,
  canRequestCustomerAssigneeUpdate,
  isStaffUnclaimedPublicPoolCustomer,
} from "@/lib/permissions/customers";
import { canConfirmPendingCustomerName } from "@/lib/customers/confirm-name";
import { canSubmitApprovalRequest } from "@/lib/permissions/approvals";
import { enrichCustomerResponse } from "@/lib/customers/scoring/service";
import { resolveAdminCustomerDetailDisplayNames, resolveCustomerDetailDisplayNames } from "@/lib/customers/user-labels";
import { listCustomerAssignees } from "@/lib/customers/assignees";
import { getDb } from "@/lib/db";
import { listFollowUpsByCustomerId } from "@/lib/follow-ups/queries";
import { getCustomerTimeline, assertCanViewCustomerTimeline } from "@/lib/customers/timeline/service";
import { getEffectiveSettings } from "@/lib/settings/effective";
import { getAuthValidationPerf } from "@/lib/auth/validation-perf";
import {
  measureAsync,
  perfNow,
  shouldEnableCustomerDetailPerf,
  type CustomerDetailPerfTimings,
} from "@/lib/customers/customer-detail-perf";
import { CustomerStatePanel } from "@/components/customers/customer-state-panel";
import { CustomerDetailClient } from "./customer-detail-client";
import { CustomerDetailPerfPanel } from "./customer-detail-perf-panel";
import { getCustomerPendingApprovalFlags } from "@/lib/customers/customer-pending-approval-flags";
import { parseSafeFollowUpsReturnTo } from "@/lib/follow-ups/safe-return-to";
import { parseSafeWorkItemsReturnTo } from "@/lib/work-items/safe-return-to";
import { getCustomerHouseholdDetailSummary } from "@/lib/customers/households/detail-summary";
import { canManageCustomerFamily, canManageExistingFamilySource } from "@/lib/customers/households/family-permissions";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

function firstSearchParam(
  value: string | string[] | undefined,
): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return undefined;
}

export default async function CustomerDetailPage({ params, searchParams }: Props) {
  const pageStart = perfNow();
  const { id } = await params;
  const query = await searchParams;
  const returnToRaw = firstSearchParam(query.returnTo);
  const safeReturnHref =
    parseSafeWorkItemsReturnTo(returnToRaw) ??
    parseSafeFollowUpsReturnTo(returnToRaw) ??
    "/customers";

  const { result: user, durationMs: authMs } = await measureAsync(() =>
    requireAuthCached(),
  );
  const enablePerf = shouldEnableCustomerDetailPerf(
    user.role,
    firstSearchParam(query.perf),
  );

  const db = getDb();
  const isStaff = user.role === "staff";
  const bootstrapStart = perfNow();
  let customerTimed;
  let pendingFlagsTimed;
  let assigneesTimed: {
    result: Awaited<ReturnType<typeof listCustomerAssignees>> | undefined;
    durationMs: number;
  };

  if (isStaff) {
    [customerTimed, pendingFlagsTimed, assigneesTimed] = await Promise.all([
      measureAsync(() => getCustomerById(id)),
      measureAsync(() => getCustomerPendingApprovalFlags(db, id)),
      measureAsync(() => listCustomerAssignees(db, id)),
    ]);
  } else {
    [customerTimed, pendingFlagsTimed] = await Promise.all([
      measureAsync(() => getCustomerById(id)),
      measureAsync(() => getCustomerPendingApprovalFlags(db, id)),
    ]);
    assigneesTimed = { result: undefined, durationMs: 0 };
  }

  const bootstrapMs = perfNow() - bootstrapStart;
  const customer = customerTimed.result;
  const pendingFlags = pendingFlagsTimed.result;
  const pendingApprovalMs = pendingFlagsTimed.durationMs;
  const preloadedAssignees = isStaff ? assigneesTimed.result : undefined;

  if (!customer) {
    return (
      <CustomerStatePanel
        titleKey="customers.notFound"
        backHref="/customers"
      />
    );
  }

  if (pendingFlags.pendingOnHoldCreate) {
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

  const accessOptions = isStaff
    ? resolveCustomerAccessOptionsFromAssignees(user, preloadedAssignees!)
    : {};
  const accessResolutionMs = isStaff ? assigneesTimed.durationMs : 0;

  const secondaryStart = perfNow();

  const effectiveSettingsPromise = getEffectiveSettings(db);

  const followUpsChainPromise = (async () => {
    try {
      assertCanViewFollowUps(user, customer, accessOptions);
      const measured = await measureAsync(() => listFollowUpsByCustomerId(id));
      return {
        followUps: measured.result,
        hasFollowUp: measured.result.length > 0,
        durationMs: measured.durationMs,
        canViewFollowUps: true,
      };
    } catch {
      return {
        followUps: undefined as
          | Awaited<ReturnType<typeof listFollowUpsByCustomerId>>
          | undefined,
        hasFollowUp: undefined as boolean | undefined,
        durationMs: 0,
        canViewFollowUps: false,
      };
    }
  })();

  const scoringPromise = Promise.all([
    followUpsChainPromise,
    effectiveSettingsPromise,
  ]).then(([chain, settings]) =>
    measureAsync(() =>
      enrichCustomerResponse(db, user, customer, new Date(), accessOptions, {
        hasFollowUp: chain.hasFollowUp,
        preloadedSettings: settings,
      }),
    ),
  );

  const familySummaryPromise = measureAsync(() =>
    getCustomerHouseholdDetailSummary(db, user, customer),
  );
  const confirmNamePromise = measureAsync(() =>
    canConfirmPendingCustomerName(db, user, customer, {
      preloadedAssignees: isStaff ? preloadedAssignees : undefined,
    }),
  );
  const displayNamesPromise = isStaff
    ? measureAsync(() =>
        resolveCustomerDetailDisplayNames(db, customer, preloadedAssignees!),
      )
    : measureAsync(() =>
        resolveAdminCustomerDetailDisplayNames(db, id, customer),
      );

  const timelineFollowUpsPromise = (async () => {
    const followUpChain = await followUpsChainPromise;
    if (followUpChain.followUps !== undefined) {
      return followUpChain.followUps;
    }
    try {
      assertCanViewCustomerTimeline(user, customer, accessOptions);
      const measured = await measureAsync(() => listFollowUpsByCustomerId(id));
      return measured.result;
    } catch {
      return undefined;
    }
  })();

  const timelinePromise = measureAsync(() =>
    getCustomerTimeline(db, user, customer, accessOptions, {
      followUpsPromise: timelineFollowUpsPromise,
    }),
  );

  let scoresView;
  let scoringMs = 0;
  try {
    const scored = await scoringPromise;
    scoresView = scored.result;
    scoringMs = scored.durationMs;
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
  const showManageFamilyButton = canManageCustomerFamily(user, customer);
  const showManageExistingFamilyButton = canManageExistingFamilySource(user, customer);
  const showReleaseButton = canReleaseToPool(user, customer);
  const showFollowUpButton = canAddFollowUp(user, customer, accessOptions);
  const showApprovalButton = canSubmitApprovalRequest(user, customer);
  const pendingPriorityApproval =
    showApprovalButton && pendingFlags.pendingPriority;
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

  const [
    followUpChain,
    confirmTimed,
    timelineTimed,
    displayNamesTimed,
    familySummaryTimed,
  ] = await Promise.all([
    followUpsChainPromise,
    confirmNamePromise,
    timelinePromise,
    displayNamesPromise,
    familySummaryPromise,
  ]);
  const secondaryTotalMs = perfNow() - secondaryStart;
  const followUps = followUpChain.canViewFollowUps
    ? (followUpChain.followUps ?? [])
    : [];
  const timeline = timelineTimed.result;
  const displayNames = displayNamesTimed.result;
  const familySummary = familySummaryTimed.result;

  const perfTimings: CustomerDetailPerfTimings | null = enablePerf
    ? {
        serverDataReadyTotalMs: perfNow() - pageStart,
        authMs,
        customerLookupMs: customerTimed.durationMs,
        bootstrapMs,
        pendingApprovalMs,
        accessResolutionMs,
        scoringMs,
        secondaryTotalMs,
        followUpsMs: followUpChain.durationMs,
        timelineMs: timelineTimed.durationMs,
        confirmNameMs: confirmTimed.durationMs,
        userLabelsMs: displayNamesTimed.durationMs,
        assigneeNamesMs: displayNamesTimed.durationMs,
        ...(getAuthValidationPerf() ?? {}),
      }
    : null;

  return (
    <>
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
          ownerName: displayNames.ownerName,
          assigneeNames: displayNames.assigneeNames,
          createdByName: displayNames.createdByName,
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
        showConfirmNameButton={confirmTimed.result}
        showManageAssigneesButton={showManageAssigneesButton}
        showRequestAssigneesButton={showRequestAssigneesButton}
        returnHref={safeReturnHref}
        familySummary={familySummary}
        showManageFamilyButton={showManageFamilyButton}
        showManageExistingFamilyButton={showManageExistingFamilyButton}
        pendingPriorityApproval={pendingPriorityApproval}
      />
      {perfTimings ? <CustomerDetailPerfPanel timings={perfTimings} /> : null}
    </>
  );
}
