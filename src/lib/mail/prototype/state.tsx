"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  createInitialMockMessages,
  MOCK_ADMIN_MAILBOX,
  MOCK_CLIENT_SERVICE_SENDER,
  MOCK_SHARED_MAILBOX,
  MOCK_STAFF_A_MAILBOX,
  MOCK_STAFF_B_MAILBOX,
} from "./mock-data";
import type {
  MailApprovalSnapshot,
  MailComposeMode,
  MailFolderId,
  MailMailbox,
  MailMessage,
  MailPrototypeScenario,
  MailQuotedOriginal,
  MailSensitivity,
  MailStatusSummary,
} from "./types";
import { hasMeaningfulDraftContent, isBlankDraft } from "./draft-helpers";
import { matchesMessageSearch } from "./search-filter";
import {
  createInitialActivityEvents,
  createInitialInternalNotes,
} from "./shared-mailbox-data";
import type {
  MailActivityEvent,
  MailInternalNote,
  MockMentionNotification,
  MockTeamMemberId,
  SharedPermissionLevel,
  SharedProcessingStatus,
  SharedViewFilter,
} from "./shared-mailbox-types";
import { MOCK_SHARED_MAILBOX_ID } from "./shared-mailbox-types";
import {
  applyStatusTransition,
  getCurrentTeamMemberId,
  getSharedAuthorizedMembers,
  getTeamMemberName,
  isSharedMailboxMessage,
  legacyAssignmentFromShared,
  matchesSharedViewFilter,
  resolveSharedPermission,
} from "./shared-mailbox";

export type MockComposeDraft = {
  from: string;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  body: string;
  replyToId?: string;
  mode?: MailComposeMode;
  draftMessageId?: string;
  quotedOriginal?: MailQuotedOriginal;
  forwardAttachments?: MailMessage["attachments"];
  selectedForwardAttachmentIds?: string[];
  customerAssociation?: { id: string; name: string } | null;
  sensitivity?: MailSensitivity;
  submittedByName?: string;
  approvalMessageId?: string;
  adminEdited?: boolean;
  approvalOriginal?: MailApprovalSnapshot;
  mockAttachmentCount?: number;
};

export type ComposeSaveStatus = "idle" | "saving" | "saved";

type MailPrototypeContextValue = {
  scenario: MailPrototypeScenario;
  setScenario: (scenario: MailPrototypeScenario) => void;
  messages: MailMessage[];
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
  activeFolder: MailFolderId;
  setActiveFolder: (folder: MailFolderId) => void;
  activeMailbox: string;
  setActiveMailbox: (address: string) => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  mailboxes: MailMailbox[];
  /** Admin-authorized From identities for compose (may differ from mailboxes). */
  senderIdentities: MailMailbox[];
  hasMailAccess: boolean;
  isAdminScenario: boolean;
  isStaffScenario: boolean;
  statusSummary: MailStatusSummary;
  primaryMailbox: string;
  markMessageRead: (id: string) => void;
  claimMessage: (id: string) => void;
  submitForApproval: (draft: {
    from: string;
    to: string[];
    cc?: string[];
    bcc?: string[];
    subject: string;
    body: string;
    replyToId?: string;
  }) => void;
  adminSend: (draft: {
    from: string;
    to: string[];
    cc?: string[];
    bcc?: string[];
    subject: string;
    body: string;
  }) => void;
  approveMessage: (id: string) => void;
  returnMessage: (id: string, reason: string) => void;
  toast: string | null;
  showToast: (message: string) => void;
  clearToast: () => void;
  filteredMessages: MailMessage[];
  folderCounts: Record<MailFolderId, number>;
  composeDraft: MockComposeDraft | null;
  composeSaveStatus: ComposeSaveStatus;
  composeSavedAt: string | null;
  initComposeDraft: (initial?: Partial<MockComposeDraft>) => void;
  updateComposeDraft: (patch: Partial<MockComposeDraft>) => void;
  markComposeSaving: () => void;
  markComposeSaved: () => void;
  clearComposeDraft: () => void;
  persistComposeDraftOnClose: () => boolean;
  openDraftMessage: (id: string) => Partial<MockComposeDraft>;
  toggleMessageImportant: (id: string) => void;
  setMessageCustomerAssociation: (
    messageId: string,
    association: { id: string; name: string } | null,
  ) => void;
  withdrawApproval: (id: string) => void;
  openAdminEditApproval: (id: string) => Partial<MockComposeDraft>;
  sharedViewFilter: SharedViewFilter;
  setSharedViewFilter: (filter: SharedViewFilter) => void;
  sharedPermissionLevel: SharedPermissionLevel;
  setSharedPermissionLevel: (level: SharedPermissionLevel) => void;
  currentTeamMemberId: MockTeamMemberId;
  sharedPermission: {
    canRead: boolean;
    canReply: boolean;
    canSend: boolean;
  };
  claimSharedMessage: (id: string) => void;
  setSharedProcessingStatus: (
    id: string,
    status: SharedProcessingStatus,
  ) => void;
  transferSharedMessage: (
    id: string,
    toUserId: MockTeamMemberId,
  ) => void;
  getTransferCandidates: () => MockTeamMemberId[];
  getNotesForMessage: (messageId: string) => MailInternalNote[];
  addInternalNote: (
    messageId: string,
    content: string,
    mentions: MockTeamMemberId[],
  ) => void;
  getMentionCandidates: () => MockTeamMemberId[];
  getActivityForMessage: (messageId: string) => MailActivityEvent[];
  mentionNotifications: MockMentionNotification[];
  openMessageFromNotification: (messageId: string) => void;
};

const MailPrototypeContext = createContext<MailPrototypeContextValue | null>(
  null,
);

function scenarioMailboxes(scenario: MailPrototypeScenario): MailMailbox[] {
  switch (scenario) {
    case "admin":
      return [MOCK_ADMIN_MAILBOX];
    case "staff_single":
      return [MOCK_STAFF_A_MAILBOX];
    case "staff_b":
      return [MOCK_STAFF_B_MAILBOX];
    case "staff_multiple":
    case "shared_mailbox":
      return [MOCK_STAFF_A_MAILBOX, MOCK_SHARED_MAILBOX];
    case "staff_no_access":
      return [];
  }
}

/** Mock Mail Admin–authorized sender identities per scenario (prototype only). */
function scenarioSenderIdentities(
  scenario: MailPrototypeScenario,
): MailMailbox[] {
  switch (scenario) {
    case "admin":
      return [MOCK_ADMIN_MAILBOX, MOCK_CLIENT_SERVICE_SENDER];
    case "staff_single":
      return [MOCK_STAFF_A_MAILBOX];
    case "staff_b":
      return [MOCK_STAFF_B_MAILBOX];
    case "staff_multiple":
    case "shared_mailbox":
      return [MOCK_STAFF_A_MAILBOX, MOCK_SHARED_MAILBOX];
    case "staff_no_access":
      return [];
  }
}

function scenarioHasAccess(scenario: MailPrototypeScenario): boolean {
  return scenario !== "staff_no_access";
}

function folderToMessageStatus(folder: MailFolderId): MailMessage["folder"] {
  if (folder === "drafts") return "draft";
  return folder;
}

export function MailPrototypeProvider({ children }: { children: ReactNode }) {
  const [scenario, setScenarioState] =
    useState<MailPrototypeScenario>("admin");
  const [messages, setMessages] = useState<MailMessage[]>(
    createInitialMockMessages,
  );
  const [selectedId, setSelectedId] = useState<string | null>("msg-1");
  const [activeFolder, setActiveFolder] = useState<MailFolderId>("inbox");
  const [activeMailbox, setActiveMailbox] = useState(
    MOCK_ADMIN_MAILBOX.address,
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const [composeDraft, setComposeDraft] = useState<MockComposeDraft | null>(
    null,
  );
  const [composeSaveStatus, setComposeSaveStatus] =
    useState<ComposeSaveStatus>("idle");
  const [composeSavedAt, setComposeSavedAt] = useState<string | null>(null);
  const [sharedViewFilter, setSharedViewFilter] =
    useState<SharedViewFilter>("all");
  const [sharedPermissionLevel, setSharedPermissionLevel] =
    useState<SharedPermissionLevel>("full");
  const [internalNotes, setInternalNotes] = useState<MailInternalNote[]>(
    createInitialInternalNotes,
  );
  const [activityEvents, setActivityEvents] = useState<MailActivityEvent[]>(
    createInitialActivityEvents,
  );
  const [mentionNotifications, setMentionNotifications] = useState<
    MockMentionNotification[]
  >([]);
  const composeDraftRef = useRef<MockComposeDraft | null>(null);
  composeDraftRef.current = composeDraft;

  const currentTeamMemberId = useMemo(
    () => getCurrentTeamMemberId(scenario),
    [scenario],
  );

  const sharedPermission = useMemo(() => {
    if (activeMailbox !== MOCK_SHARED_MAILBOX_ID) {
      return { canRead: true, canReply: true, canSend: true };
    }
    return resolveSharedPermission(
      currentTeamMemberId,
      sharedPermissionLevel,
    );
  }, [activeMailbox, currentTeamMemberId, sharedPermissionLevel]);

  const mailboxes = useMemo(() => scenarioMailboxes(scenario), [scenario]);
  const senderIdentities = useMemo(
    () => scenarioSenderIdentities(scenario),
    [scenario],
  );
  const hasMailAccess = scenarioHasAccess(scenario);
  const isAdminScenario = scenario === "admin";
  const isStaffScenario =
    scenario === "staff_single" ||
    scenario === "staff_multiple" ||
    scenario === "staff_b" ||
    scenario === "shared_mailbox";

  const setScenario = useCallback((next: MailPrototypeScenario) => {
    setScenarioState(next);
    const boxes = scenarioMailboxes(next);
    setActiveMailbox(
      next === "shared_mailbox"
        ? "hello@echfronthk.com"
        : (boxes[0]?.address ?? ""),
    );
    setActiveFolder("inbox");
    setSelectedId(
      next === "staff_no_access"
        ? null
        : next === "shared_mailbox"
          ? "msg-3"
          : "msg-1",
    );
    setSearchQuery("");
    setMessages(createInitialMockMessages());
    setSharedViewFilter("all");
    setSharedPermissionLevel("full");
    setInternalNotes(createInitialInternalNotes());
    setActivityEvents(createInitialActivityEvents());
    setMentionNotifications([]);
  }, []);

  const primaryMailbox =
    mailboxes.find((m) => m.label === "personal")?.address ??
    mailboxes[0]?.address ??
    "";

  const showToast = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 3200);
  }, []);

  const clearToast = useCallback(() => setToast(null), []);

  const initComposeDraft = useCallback(
    (initial?: Partial<MockComposeDraft>) => {
      const defaultFrom =
        activeMailbox ||
        senderIdentities[0]?.address ||
        mailboxes[0]?.address ||
        MOCK_ADMIN_MAILBOX.address;
      if (initial) {
        setComposeDraft({
          from: initial.from ?? defaultFrom,
          to: initial.to ?? [],
          cc: initial.cc ?? [],
          bcc: initial.bcc ?? [],
          subject: initial.subject ?? "",
          body: initial.body ?? "",
          replyToId: initial.replyToId,
          mode: initial.mode ?? "new",
          draftMessageId: initial.draftMessageId,
          quotedOriginal: initial.quotedOriginal,
          forwardAttachments: initial.forwardAttachments,
          selectedForwardAttachmentIds: initial.selectedForwardAttachmentIds ?? [],
          customerAssociation: initial.customerAssociation ?? null,
          sensitivity: initial.sensitivity ?? "normal",
          submittedByName: initial.submittedByName,
          approvalMessageId: initial.approvalMessageId,
          adminEdited: initial.adminEdited,
          approvalOriginal: initial.approvalOriginal,
          mockAttachmentCount: initial.mockAttachmentCount ?? 0,
        });
        setComposeSaveStatus("idle");
        setComposeSavedAt(null);
        return;
      }

      if (composeDraftRef.current) {
        return;
      }

      setComposeDraft({
        from: defaultFrom,
        to: [],
        cc: [],
        bcc: [],
        subject: "",
        body: "",
        mode: "new",
        sensitivity: "normal",
        customerAssociation: null,
        selectedForwardAttachmentIds: [],
        mockAttachmentCount: 0,
      });
      setComposeSaveStatus("idle");
      setComposeSavedAt(null);
    },
    [activeMailbox, mailboxes, senderIdentities],
  );

  const updateComposeDraft = useCallback((patch: Partial<MockComposeDraft>) => {
    setComposeDraft((prev) => {
      if (!prev) return prev;
      return { ...prev, ...patch };
    });
  }, []);

  const markComposeSaving = useCallback(() => {
    setComposeSaveStatus("saving");
  }, []);

  const markComposeSaved = useCallback(() => {
    setComposeSaveStatus("saved");
    setComposeSavedAt(new Date().toISOString());
  }, []);

  const clearComposeDraft = useCallback(() => {
    setComposeDraft(null);
    setComposeSaveStatus("idle");
    setComposeSavedAt(null);
  }, []);

  const persistComposeDraftOnClose = useCallback(() => {
    const draft = composeDraftRef.current;
    if (!draft) return false;
    if (isBlankDraft(draft)) {
      if (draft.draftMessageId) {
        setMessages((prev) =>
          prev.filter((m) => m.id !== draft.draftMessageId),
        );
      }
      clearComposeDraft();
      return false;
    }

    const now = new Date().toISOString();
    const plainBody = draft.body.replace(/<[^>]*>/g, "").trim();
    const preview =
      plainBody.slice(0, 60) || draft.subject.trim() || "…";

    const selectedForward = (draft.forwardAttachments ?? []).filter((a) =>
      (draft.selectedForwardAttachmentIds ?? []).includes(a.id),
    );
    const mockCount =
      (draft.mockAttachmentCount ?? 0) + selectedForward.length;

    const upsert: Omit<MailMessage, "id"> = {
      folder: "draft",
      mailbox: draft.from,
      fromName: isAdminScenario ? "Daniel" : "Employee A",
      fromEmail: draft.from,
      to: draft.to,
      cc: draft.cc.length > 0 ? draft.cc : undefined,
      bcc: draft.bcc.length > 0 ? draft.bcc : undefined,
      subject: draft.subject.trim() || "(No subject)",
      preview,
      body: plainBody || draft.body,
      sentAt: now,
      isUnread: false,
      hasAttachment: mockCount > 0,
      attachments: selectedForward,
      customerMatch: draft.customerAssociation ?? null,
      manualCustomerAssociation: draft.customerAssociation ?? null,
      assignment: "none",
      draftUpdatedAt: now,
      sensitivity: draft.sensitivity,
    };

    if (draft.draftMessageId) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === draft.draftMessageId ? { ...m, ...upsert, id: m.id } : m,
        ),
      );
    } else {
      const newId = `draft-${Date.now()}`;
      setMessages((prev) => [{ id: newId, ...upsert }, ...prev]);
    }

    clearComposeDraft();
    return true;
  }, [clearComposeDraft, isAdminScenario]);

  const openDraftMessage = useCallback(
    (id: string): Partial<MockComposeDraft> => {
      const msg = messages.find((m) => m.id === id && m.folder === "draft");
      if (!msg) return {};
      return {
        from: msg.fromEmail || msg.mailbox,
        to: msg.to,
        cc: msg.cc ?? [],
        bcc: msg.bcc ?? [],
        subject: msg.subject === "(No subject)" ? "" : msg.subject,
        body: msg.body,
        mode: "new",
        draftMessageId: msg.id,
        sensitivity: msg.sensitivity ?? "normal",
        customerAssociation:
          msg.manualCustomerAssociation ?? msg.customerMatch,
        mockAttachmentCount: msg.attachments.length,
      };
    },
    [messages],
  );

  const toggleMessageImportant = useCallback((id: string) => {
    setMessages((prev) =>
      prev.map((m) =>
        m.id === id ? { ...m, isImportant: !m.isImportant } : m,
      ),
    );
  }, []);

  const setMessageCustomerAssociation = useCallback(
    (messageId: string, association: { id: string; name: string } | null) => {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId
            ? { ...m, manualCustomerAssociation: association }
            : m,
        ),
      );
    },
    [],
  );

  const withdrawApproval = useCallback(
    (id: string) => {
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== id || m.folder !== "pending_approval") return m;
          return {
            ...m,
            folder: "draft" as const,
            draftUpdatedAt: new Date().toISOString(),
          };
        }),
      );
      setActiveFolder("drafts");
      showToast("已撤回至草稿");
    },
    [showToast],
  );

  const openAdminEditApproval = useCallback(
    (id: string): Partial<MockComposeDraft> => {
      const msg = messages.find((m) => m.id === id);
      if (!msg) return {};
      const original: MailApprovalSnapshot = msg.approvalOriginal ?? {
        subject: msg.subject,
        body: msg.body,
        to: msg.to,
        cc: msg.cc,
        bcc: msg.bcc,
      };
      return {
        from: msg.fromEmail,
        to: msg.to,
        cc: msg.cc ?? [],
        bcc: msg.bcc ?? [],
        subject: msg.subject,
        body: msg.body,
        mode: "edit_approval",
        approvalMessageId: msg.id,
        submittedByName: msg.submittedByName,
        approvalOriginal: original,
        adminEdited: msg.adminEdited,
        sensitivity: msg.sensitivity ?? "normal",
      };
    },
    [messages],
  );

  const markMessageRead = useCallback(
    (id: string) => {
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== id) return m;
          if (isSharedMailboxMessage(m)) {
            const readBy = new Set(m.readByUserIds ?? []);
            readBy.add(currentTeamMemberId);
            return { ...m, readByUserIds: [...readBy] };
          }
          return { ...m, isUnread: false };
        }),
      );
    },
    [currentTeamMemberId],
  );

  const appendActivity = useCallback((event: MailActivityEvent) => {
    setActivityEvents((prev) => [...prev, event]);
  }, []);

  const claimSharedMessage = useCallback(
    (id: string) => {
      if (!sharedPermission.canReply) return;
      const now = new Date().toISOString();
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== id || !isSharedMailboxMessage(m)) return m;
          const next = {
            ...m,
            processingStatus: "in_progress" as const,
            assigneeId: currentTeamMemberId,
          };
          return {
            ...next,
            assignment: legacyAssignmentFromShared(next, currentTeamMemberId),
            assignedToName: getTeamMemberName(currentTeamMemberId),
          };
        }),
      );
      appendActivity({
        id: `act-${Date.now()}`,
        messageId: id,
        type: "claimed",
        actorId: currentTeamMemberId,
        timestamp: now,
      });
      showToast("已接手");
    },
    [
      appendActivity,
      currentTeamMemberId,
      sharedPermission.canReply,
      showToast,
    ],
  );

  const claimMessage = useCallback(
    (id: string) => {
      const msg = messages.find((m) => m.id === id);
      if (msg && isSharedMailboxMessage(msg)) {
        claimSharedMessage(id);
        return;
      }
      setMessages((prev) =>
        prev.map((m) =>
          m.id === id
            ? {
                ...m,
                assignment: "assigned_to_me" as const,
                assignedToName: getTeamMemberName(currentTeamMemberId),
              }
            : m,
        ),
      );
      showToast("已接手");
    },
    [claimSharedMessage, currentTeamMemberId, messages, showToast],
  );

  const setSharedProcessingStatus = useCallback(
    (id: string, status: SharedProcessingStatus) => {
      if (!sharedPermission.canReply) return;
      const msg = messages.find((m) => m.id === id);
      if (!msg || !isSharedMailboxMessage(msg)) return;

      let assigneeId = msg.assigneeId ?? null;
      if (
        status === "in_progress" &&
        !assigneeId &&
        status !== msg.processingStatus
      ) {
        showToast("請先接手或指定負責人");
        return;
      }

      try {
        const next = applyStatusTransition(status, assigneeId);
        setMessages((prev) =>
          prev.map((m) => {
            if (m.id !== id) return m;
            const updated = { ...m, ...next };
            return {
              ...updated,
              assignment: legacyAssignmentFromShared(
                updated,
                currentTeamMemberId,
              ),
              assignedToName: updated.assigneeId
                ? getTeamMemberName(updated.assigneeId)
                : undefined,
            };
          }),
        );
        appendActivity({
          id: `act-${Date.now()}`,
          messageId: id,
          type: status === "completed" ? "completed" : "status_changed",
          actorId: currentTeamMemberId,
          timestamp: new Date().toISOString(),
          metadata: { status },
        });
      } catch {
        showToast("無法更新狀態");
      }
    },
    [
      appendActivity,
      currentTeamMemberId,
      messages,
      sharedPermission.canReply,
      showToast,
    ],
  );

  const transferSharedMessage = useCallback(
    (id: string, toUserId: MockTeamMemberId) => {
      if (!sharedPermission.canReply) return;
      const msg = messages.find((m) => m.id === id);
      if (!msg || !isSharedMailboxMessage(msg)) return;
      const fromAssignee = msg.assigneeId ?? null;
      if (
        fromAssignee !== currentTeamMemberId &&
        currentTeamMemberId !== "admin"
      ) {
        return;
      }
      if (!getSharedAuthorizedMembers().includes(toUserId)) return;

      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== id) return m;
          const updated = { ...m, assigneeId: toUserId };
          return {
            ...updated,
            assignment: legacyAssignmentFromShared(
              updated,
              currentTeamMemberId,
            ),
            assignedToName: getTeamMemberName(toUserId),
          };
        }),
      );
      appendActivity({
        id: `act-${Date.now()}`,
        messageId: id,
        type: "transferred",
        actorId: currentTeamMemberId,
        timestamp: new Date().toISOString(),
        metadata: { fromAssigneeId: fromAssignee, toAssigneeId: toUserId },
      });
      showToast("已轉交");
    },
    [
      appendActivity,
      currentTeamMemberId,
      messages,
      sharedPermission.canReply,
      showToast,
    ],
  );

  const getTransferCandidates = useCallback((): MockTeamMemberId[] => {
    return getSharedAuthorizedMembers().filter(
      (id) => id !== currentTeamMemberId,
    );
  }, [currentTeamMemberId]);

  const getNotesForMessage = useCallback(
    (messageId: string) =>
      internalNotes.filter((n) => n.messageId === messageId),
    [internalNotes],
  );

  const getMentionCandidates = useCallback(
    () => getSharedAuthorizedMembers(),
    [],
  );

  const getActivityForMessage = useCallback(
    (messageId: string) =>
      activityEvents.filter((e) => e.messageId === messageId),
    [activityEvents],
  );

  const addInternalNote = useCallback(
    (messageId: string, content: string, mentions: MockTeamMemberId[]) => {
      if (!sharedPermission.canReply) return;
      const msg = messages.find((m) => m.id === messageId);
      if (!msg || !isSharedMailboxMessage(msg)) return;

      const noteId = `note-${Date.now()}`;
      const createdAt = new Date().toISOString();
      const note: MailInternalNote = {
        id: noteId,
        messageId,
        authorId: currentTeamMemberId,
        content,
        mentions,
        createdAt,
      };
      setInternalNotes((prev) => [...prev, note]);
      appendActivity({
        id: `act-${Date.now()}`,
        messageId,
        type: "note_added",
        actorId: currentTeamMemberId,
        timestamp: createdAt,
        metadata: { notePreview: content.slice(0, 40) },
      });

      const subjectPreview = msg.subject.slice(0, 60);
      const mailboxDisplayName =
        MOCK_SHARED_MAILBOX.displayName ?? MOCK_SHARED_MAILBOX_ID;
      const newNotifications: MockMentionNotification[] = mentions
        .filter((uid) => uid !== currentTeamMemberId)
        .map((targetUserId) => ({
          id: `mn-${Date.now()}-${targetUserId}`,
          messageId,
          mailboxDisplayName,
          subjectPreview,
          authorId: currentTeamMemberId,
          targetUserId,
          createdAt,
        }));
      if (newNotifications.length > 0) {
        setMentionNotifications((prev) => [...prev, ...newNotifications]);
        showToast("已通知被 @ 的成員（原型）");
      }
    },
    [
      appendActivity,
      currentTeamMemberId,
      messages,
      sharedPermission.canReply,
      showToast,
    ],
  );

  const openMessageFromNotification = useCallback(
    (messageId: string) => {
      const msg = messages.find((m) => m.id === messageId);
      if (!msg) return;
      setActiveMailbox(msg.mailbox);
      setActiveFolder(
        msg.folder === "draft"
          ? "drafts"
          : msg.folder === "pending_approval"
            ? "pending_approval"
            : msg.folder === "pending_my_approval"
              ? "pending_my_approval"
              : msg.folder === "returned"
                ? "returned"
                : msg.folder === "sent"
                  ? "sent"
                  : msg.folder === "trash"
                    ? "trash"
                    : msg.folder === "pending"
                      ? "pending"
                      : "inbox",
      );
      setSelectedId(messageId);
      markMessageRead(messageId);
    },
    [markMessageRead, messages],
  );

  const submitForApproval = useCallback(
    (draft: {
      from: string;
      to: string[];
      cc?: string[];
      bcc?: string[];
      subject: string;
      body: string;
      replyToId?: string;
    }) => {
      const newId = `msg-new-${Date.now()}`;
      const msg: MailMessage = {
        id: newId,
        folder: "pending_approval",
        mailbox: draft.from,
        fromName: "Employee A",
        fromEmail: draft.from,
        to: draft.to,
        cc: draft.cc,
        bcc: draft.bcc,
        subject: draft.subject,
        preview: draft.body.slice(0, 60),
        body: draft.body,
        sentAt: new Date().toISOString(),
        isUnread: false,
        hasAttachment: false,
        attachments: [],
        customerMatch: null,
        assignment: "none",
        submittedByName: "Employee A",
        submittedAt: new Date().toISOString(),
      };
      setMessages((prev) => [msg, ...prev]);
      setActiveFolder("pending_approval");
      setSelectedId(newId);
      clearComposeDraft();
      showToast("已提交审核");
    },
    [showToast, clearComposeDraft],
  );

  const adminSend = useCallback(
    (draft: {
      from: string;
      to: string[];
      cc?: string[];
      bcc?: string[];
      subject: string;
      body: string;
      sensitivity?: MailSensitivity;
      approvalMessageId?: string;
      adminEdited?: boolean;
    }) => {
      if (draft.approvalMessageId) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === draft.approvalMessageId
              ? {
                  ...m,
                  folder: "sent" as const,
                  subject: draft.subject,
                  body: draft.body,
                  to: draft.to,
                  cc: draft.cc,
                  bcc: draft.bcc,
                  preview: draft.body.slice(0, 60),
                  deliveryStatus: "sent" as const,
                  adminEdited: draft.adminEdited ?? true,
                  sensitivity: draft.sensitivity,
                }
              : m,
          ),
        );
        setActiveFolder("sent");
        setSelectedId(draft.approvalMessageId);
        clearComposeDraft();
        showToast("UI Prototype：未实际发送邮件");
        return;
      }

      const newId = `msg-sent-${Date.now()}`;
      const msg: MailMessage = {
        id: newId,
        folder: "sent",
        mailbox: draft.from,
        fromName: "Daniel",
        fromEmail: draft.from,
        to: draft.to,
        cc: draft.cc,
        bcc: draft.bcc,
        subject: draft.subject,
        preview: draft.body.slice(0, 60),
        body: draft.body,
        sentAt: new Date().toISOString(),
        isUnread: false,
        hasAttachment: false,
        attachments: [],
        customerMatch: null,
        assignment: "none",
        deliveryStatus: "sent",
        sensitivity: draft.sensitivity,
      };
      setMessages((prev) => [msg, ...prev]);
      setActiveFolder("sent");
      setSelectedId(newId);
      clearComposeDraft();
      showToast("UI Prototype：未实际发送邮件");
    },
    [showToast, clearComposeDraft],
  );

  const approveMessage = useCallback(
    (id: string) => {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === id ? { ...m, folder: "sent", isUnread: false } : m,
        ),
      );
      showToast("UI Prototype：审批通过，未实际发送");
    },
    [showToast],
  );

  const returnMessage = useCallback(
    (id: string, reason: string) => {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === id
            ? { ...m, folder: "returned", returnReason: reason, isUnread: true }
            : m,
        ),
      );
      showToast("已退回修改");
    },
    [showToast],
  );

  const filteredMessages = useMemo(() => {
    if (!hasMailAccess) return [];
    const folderStatus = folderToMessageStatus(activeFolder);

    return messages.filter((m) => {
      if (m.folder !== folderStatus) return false;
      if (activeFolder === "pending_my_approval" && scenario !== "admin") {
        return false;
      }
      if (
        activeFolder !== "pending_my_approval" &&
        scenario !== "admin" &&
        m.mailbox !== activeMailbox
      ) {
        return false;
      }
      if (
        activeMailbox === MOCK_SHARED_MAILBOX_ID &&
        !matchesSharedViewFilter(m, sharedViewFilter, currentTeamMemberId)
      ) {
        return false;
      }
      if (!searchQuery.trim()) return true;
      const noteTexts =
        sharedPermission.canRead && isSharedMailboxMessage(m)
          ? getNotesForMessage(m.id).map((n) => n.content)
          : [];
      return matchesMessageSearch(m, searchQuery, scenario, noteTexts);
    });
  }, [
    messages,
    activeFolder,
    activeMailbox,
    searchQuery,
    hasMailAccess,
    scenario,
    sharedViewFilter,
    currentTeamMemberId,
    sharedPermission.canRead,
    getNotesForMessage,
  ]);

  const folderCounts = useMemo(() => {
    const count = (folder: MailFolderId) =>
      messages.filter((m) => {
        if (m.folder !== folderToMessageStatus(folder)) return false;
        if (folder === "pending_my_approval") return scenario === "admin";
        if (scenario === "admin") return true;
        return m.mailbox === activeMailbox;
      }).length;

    return {
      inbox: count("inbox"),
      pending: count("pending"),
      drafts: count("drafts"),
      pending_approval: count("pending_approval"),
      returned: count("returned"),
      sent: count("sent"),
      trash: count("trash"),
      pending_my_approval: count("pending_my_approval"),
    };
  }, [messages, activeMailbox, scenario]);

  const statusSummary = useMemo((): MailStatusSummary => {
    if (!hasMailAccess) {
      return { unread: 0 };
    }
    if (isAdminScenario) {
      return {
        unread: 8,
        pendingMyApproval: 12,
        sendErrors: 0,
      };
    }
    return {
      unread: 6,
      returned: 1,
    };
  }, [hasMailAccess, isAdminScenario]);

  const value = useMemo(
    () => ({
      scenario,
      setScenario,
      messages,
      selectedId,
      setSelectedId,
      activeFolder,
      setActiveFolder,
      activeMailbox,
      setActiveMailbox,
      searchQuery,
      setSearchQuery,
      mailboxes,
      senderIdentities,
      hasMailAccess,
      isAdminScenario,
      isStaffScenario,
      statusSummary,
      primaryMailbox,
      markMessageRead,
      claimMessage,
      submitForApproval,
      adminSend,
      approveMessage,
      returnMessage,
      toast,
      showToast,
      clearToast,
      filteredMessages,
      folderCounts,
      composeDraft,
      composeSaveStatus,
      composeSavedAt,
      initComposeDraft,
      updateComposeDraft,
      markComposeSaving,
      markComposeSaved,
      clearComposeDraft,
      persistComposeDraftOnClose,
      openDraftMessage,
      toggleMessageImportant,
      setMessageCustomerAssociation,
      withdrawApproval,
      openAdminEditApproval,
      sharedViewFilter,
      setSharedViewFilter,
      sharedPermissionLevel,
      setSharedPermissionLevel,
      currentTeamMemberId,
      sharedPermission,
      claimSharedMessage,
      setSharedProcessingStatus,
      transferSharedMessage,
      getTransferCandidates,
      getNotesForMessage,
      addInternalNote,
      getMentionCandidates,
      getActivityForMessage,
      mentionNotifications,
      openMessageFromNotification,
    }),
    [
      scenario,
      setScenario,
      messages,
      selectedId,
      activeFolder,
      activeMailbox,
      searchQuery,
      mailboxes,
      senderIdentities,
      hasMailAccess,
      isAdminScenario,
      isStaffScenario,
      statusSummary,
      primaryMailbox,
      markMessageRead,
      claimMessage,
      submitForApproval,
      adminSend,
      approveMessage,
      returnMessage,
      toast,
      showToast,
      clearToast,
      filteredMessages,
      folderCounts,
      composeDraft,
      composeSaveStatus,
      composeSavedAt,
      initComposeDraft,
      updateComposeDraft,
      markComposeSaving,
      markComposeSaved,
      clearComposeDraft,
      persistComposeDraftOnClose,
      openDraftMessage,
      toggleMessageImportant,
      setMessageCustomerAssociation,
      withdrawApproval,
      openAdminEditApproval,
      sharedViewFilter,
      setSharedViewFilter,
      sharedPermissionLevel,
      setSharedPermissionLevel,
      currentTeamMemberId,
      sharedPermission,
      claimSharedMessage,
      setSharedProcessingStatus,
      transferSharedMessage,
      getTransferCandidates,
      getNotesForMessage,
      addInternalNote,
      getMentionCandidates,
      getActivityForMessage,
      mentionNotifications,
      openMessageFromNotification,
    ],
  );

  return (
    <MailPrototypeContext.Provider value={value}>
      {children}
    </MailPrototypeContext.Provider>
  );
}

export function useMailPrototype() {
  const ctx = useContext(MailPrototypeContext);
  if (!ctx) {
    throw new Error("useMailPrototype must be used within MailPrototypeProvider");
  }
  return ctx;
}
