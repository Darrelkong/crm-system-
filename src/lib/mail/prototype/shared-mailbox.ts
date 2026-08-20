import type { MailMessage, MailPrototypeScenario } from "./types";
import type {
  MockTeamMemberId,
  SharedPermissionLevel,
  SharedProcessingStatus,
  SharedViewFilter,
} from "./shared-mailbox-types";
import { MOCK_SHARED_MAILBOX_ID } from "./shared-mailbox-types";
import {
  MOCK_SHARED_PERMISSIONS,
  MOCK_TEAM_MEMBERS,
} from "./shared-mailbox-data";
import {
  canViewCustomer,
  getActorStaffId,
  MOCK_CRM_CUSTOMERS,
} from "./recipient-permissions";

export function isSharedMailboxMessage(message: MailMessage): boolean {
  return message.mailbox === MOCK_SHARED_MAILBOX_ID;
}

export function getCurrentTeamMemberId(
  scenario: MailPrototypeScenario,
): MockTeamMemberId {
  if (scenario === "admin") return "admin";
  if (scenario === "staff_b") return "staff-b";
  return "staff-a";
}

export function getTeamMemberName(id: MockTeamMemberId): string {
  return MOCK_TEAM_MEMBERS[id]?.displayName ?? id;
}

export function resolveSharedPermission(
  userId: MockTeamMemberId,
  level: SharedPermissionLevel,
) {
  const base = MOCK_SHARED_PERMISSIONS.find(
    (p) => p.mailboxId === MOCK_SHARED_MAILBOX_ID && p.userId === userId,
  );
  if (!base?.canRead) {
    return { canRead: false, canReply: false, canSend: false };
  }
  if (level === "read_only") {
    return { canRead: true, canReply: false, canSend: false };
  }
  if (level === "reply") {
    return { canRead: true, canReply: true, canSend: false };
  }
  return {
    canRead: base.canRead,
    canReply: base.canReply,
    canSend: base.canSend,
  };
}

export function getSharedAuthorizedMembers(): MockTeamMemberId[] {
  return MOCK_SHARED_PERMISSIONS.filter(
    (p) => p.mailboxId === MOCK_SHARED_MAILBOX_ID && p.canRead,
  ).map((p) => p.userId);
}

export function canMentionUser(userId: MockTeamMemberId): boolean {
  return getSharedAuthorizedMembers().includes(userId);
}

export function isUnreadForActor(
  message: MailMessage,
  actorId: MockTeamMemberId,
): boolean {
  if (isSharedMailboxMessage(message)) {
    return !(message.readByUserIds ?? []).includes(actorId);
  }
  return message.isUnread;
}

export function applyStatusTransition(
  status: SharedProcessingStatus,
  assigneeId: MockTeamMemberId | null | undefined,
): {
  processingStatus: SharedProcessingStatus;
  assigneeId: MockTeamMemberId | null;
} {
  if (status === "unclaimed") {
    return { processingStatus: "unclaimed", assigneeId: null };
  }
  if (status === "in_progress" && !assigneeId) {
    throw new Error("in_progress requires assignee");
  }
  if (
    (status === "waiting_customer" || status === "completed") &&
    !assigneeId
  ) {
    throw new Error(`${status} requires assignee`);
  }
  return {
    processingStatus: status,
    assigneeId: assigneeId ?? null,
  };
}

export function matchesSharedViewFilter(
  message: MailMessage,
  filter: SharedViewFilter,
  currentUserId: MockTeamMemberId,
): boolean {
  if (!isSharedMailboxMessage(message)) return true;
  const status = message.processingStatus ?? "unclaimed";
  const assignee = message.assigneeId ?? null;
  switch (filter) {
    case "all":
      return true;
    case "unclaimed":
      return status === "unclaimed";
    case "mine":
      return assignee === currentUserId;
    case "waiting_customer":
      return status === "waiting_customer";
    case "completed":
      return status === "completed";
  }
}

export function legacyAssignmentFromShared(
  message: MailMessage,
  currentUserId: MockTeamMemberId,
): MailMessage["assignment"] {
  if (!isSharedMailboxMessage(message)) return message.assignment;
  const status = message.processingStatus ?? "unclaimed";
  if (status === "unclaimed" || !message.assigneeId) return "unassigned";
  if (message.assigneeId === currentUserId) return "assigned_to_me";
  return "assigned_to_other";
}

export function shouldWarnSharedReply(
  message: MailMessage,
  currentUserId: MockTeamMemberId,
): boolean {
  if (!isSharedMailboxMessage(message)) return false;
  if (!message.assigneeId) return false;
  return message.assigneeId !== currentUserId;
}

/** CRM badge: shared mailbox permission must not elevate CRM visibility */
export function shouldShowSharedCustomerBadge(
  message: MailMessage,
  scenario: MailPrototypeScenario,
): boolean {
  const actor = getActorStaffId(scenario);
  const association =
    message.manualCustomerAssociation ?? message.customerMatch;
  if (!association) return false;
  if (actor === "admin") return true;
  if (actor === null) return false;
  const customer = MOCK_CRM_CUSTOMERS.find((c) => c.id === association.id);
  if (!customer) return false;
  return canViewCustomer(customer, actor);
}
