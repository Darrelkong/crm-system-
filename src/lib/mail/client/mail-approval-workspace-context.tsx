"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  fetchAdminUsersForMailAccess,
  fetchApproval,
  fetchApprovals,
  fetchSendOperationDelivery,
  fetchSendOperationForApproval,
  fetchOutboundRevision,
} from "@/lib/mail/client/api";
import {
  buildApprovalWorkflowRows,
  buildApprovalRequesterUsersById,
  canReviewApprovals,
  enrichApprovalRequesterUsers,
  resolveApprovalRequesterLabel,
  resolveUserLabel,
  type ApprovalApiItem,
  type ApprovalWorkflowRow,
  type OutboundRevisionApiItem,
} from "@/lib/mail/client/approval-workflow-management";
import { resolveApprovalWorkspaceListScope } from "@/lib/mail/client/mail-workspace-ui-adapters";
import type { MailAccessAdminUser } from "@/lib/mail/client/mail-access-management";
import { splitComposeBodyForEditor } from "@/lib/mail/client/compose-reply-body";
import {
  isApprovalDetailReadyForReview,
  resolveApprovalAttachmentsState,
  type ApprovalAttachmentsLoadState,
} from "@/lib/mail/client/mail-approval-review-readiness";
import { useMailSession } from "@/lib/mail/client/mail-session-provider";
import type {
  SendDeliveryLifecycleApiItem,
  SendOperationApiItem,
} from "@/lib/mail/client/approved-outbound-queue";

export type { ApprovalAttachmentsLoadState };
export { isApprovalDetailReadyForReview };

export type ApprovalDetailView = {
  approval: ApprovalApiItem;
  revision: OutboundRevisionApiItem;
  requesterLabel: string;
  reviewerLabel: string;
  editableBodyHtml: string;
  quotedBodyHtml: string | null;
  sendOperation?: SendOperationApiItem | null;
  delivery?: SendDeliveryLifecycleApiItem | null;
};

export type MailApprovalWorkspaceValue = {
  rows: ApprovalWorkflowRow[];
  pendingRows: ApprovalWorkflowRow[];
  historyRows: ApprovalWorkflowRow[];
  pendingCount: number;
  selectedApprovalId: string | null;
  detail: ApprovalDetailView | null;
  isLoadingList: boolean;
  pendingLoading: boolean;
  historyLoading: boolean;
  isLoadingDetail: boolean;
  attachmentsLoadState: ApprovalAttachmentsLoadState;
  listError: string | null;
  pendingError: string | null;
  historyError: string | null;
  detailError: string | null;
  attachmentsLoadError: string | null;
  canReview: boolean;
  pendingLoaded: boolean;
  historyLoaded: boolean;
  loadApprovals: (input?: {
    dataset?: "pending" | "history";
    force?: boolean;
  }) => Promise<void>;
  selectApproval: (approvalId: string) => Promise<void>;
  clearSelection: () => void;
  refreshDetail: () => Promise<void>;
  refreshDeliveryStatus: () => Promise<void>;
};

const MailApprovalWorkspaceContext =
  createContext<MailApprovalWorkspaceValue | null>(null);

function buildDetailView(
  approval: ApprovalApiItem,
  revision: OutboundRevisionApiItem,
  usersById: Map<string, MailAccessAdminUser>,
  sendOperation: SendOperationApiItem | null,
  delivery: SendDeliveryLifecycleApiItem | null,
): ApprovalDetailView {
  const bodyHtml = revision.bodyHtmlSanitized ?? revision.bodyText;
  const split = splitComposeBodyForEditor({
    bodyHtml,
    composeMode:
      revision.composeMode === "reply" ||
      revision.composeMode === "reply_all" ||
      revision.composeMode === "forward"
        ? revision.composeMode
        : "new",
  });

  return {
    approval,
    revision,
    requesterLabel: resolveApprovalRequesterLabel(
      approval.requestedByUserId,
      usersById,
    ),
    reviewerLabel: resolveUserLabel(approval.resolvedByUserId, usersById),
    editableBodyHtml: split.editableHtml,
    quotedBodyHtml: split.quotedHtml,
    sendOperation,
    delivery,
  };
}

export function MailApprovalWorkspaceProvider({
  children,
}: {
  children: ReactNode;
}) {
  const { capabilities, session } = useMailSession();
  const canReview = canReviewApprovals(capabilities);
  const [pendingRows, setPendingRows] = useState<ApprovalWorkflowRow[]>([]);
  const [historyRows, setHistoryRows] = useState<ApprovalWorkflowRow[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [pendingLoaded, setPendingLoaded] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [selectedApprovalId, setSelectedApprovalId] = useState<string | null>(
    null,
  );
  const [detail, setDetail] = useState<ApprovalDetailView | null>(null);
  const [pendingLoading, setPendingLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [pendingError, setPendingError] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [attachmentsLoadState, setAttachmentsLoadState] =
    useState<ApprovalAttachmentsLoadState>("idle");
  const [attachmentsLoadError, setAttachmentsLoadError] = useState<string | null>(
    null,
  );
  const usersListRef = useRef<MailAccessAdminUser[]>([]);
  const usersLoadedRef = useRef(false);
  const usersRequestRef = useRef<Promise<MailAccessAdminUser[]> | null>(null);
  const detailRequestRef = useRef(0);
  const deliveryRequestRef = useRef(0);
  const pendingRequestRef = useRef<{
    generation: number;
    inFlight: Promise<void> | null;
  }>({ generation: 0, inFlight: null });
  const historyRequestRef = useRef<{
    generation: number;
    inFlight: Promise<void> | null;
  }>({ generation: 0, inFlight: null });
  const pendingLoadedRef = useRef(false);
  const historyLoadedRef = useRef(false);
  const sessionUser = session?.user ?? null;

  const loadRequesterUsers = useCallback(async () => {
    if (usersLoadedRef.current) {
      return usersListRef.current;
    }
    if (usersRequestRef.current) {
      return usersRequestRef.current;
    }
    const request = fetchAdminUsersForMailAccess()
      .then((result) => {
        const users = result.ok ? result.items : [];
        const requesterUsers = enrichApprovalRequesterUsers(users, sessionUser);
        usersListRef.current = requesterUsers;
        usersLoadedRef.current = true;
        return requesterUsers;
      })
      .catch(() => {
        usersLoadedRef.current = true;
        usersListRef.current = enrichApprovalRequesterUsers([], sessionUser);
        return usersListRef.current;
      })
      .finally(() => {
        usersRequestRef.current = null;
      });
    usersRequestRef.current = request;
    return request;
  }, [sessionUser]);

  const loadApprovals = useCallback(
    async (
      input: {
        dataset?: "pending" | "history";
        force?: boolean;
      } = {},
    ) => {
      const dataset = input.dataset ?? "pending";
      const force = input.force ?? true;
      const loadedRef =
        dataset === "pending" ? pendingLoadedRef : historyLoadedRef;
      const requestRef =
        dataset === "pending" ? pendingRequestRef : historyRequestRef;
      if (!force && loadedRef.current) {
        return;
      }
      if (requestRef.current.inFlight) {
        await requestRef.current.inFlight;
        return;
      }

      const requestGeneration = ++requestRef.current.generation;
      if (dataset === "pending") {
        setPendingLoading(true);
        setPendingError(null);
      } else {
        setHistoryLoading(true);
        setHistoryError(null);
      }

      const request = (async () => {
        try {
          const [approvalsResult, requesterUsers] = await Promise.all([
            fetchApprovals({
              scope: resolveApprovalWorkspaceListScope(canReview),
              status: dataset === "history" ? "all-reviewed" : "pending",
            }),
            loadRequesterUsers(),
          ]);
          if (!approvalsResult.ok) {
            if (dataset === "pending") {
              setPendingError(approvalsResult.error);
            } else {
              setHistoryError(approvalsResult.error);
            }
            return;
          }
          if (requestGeneration !== requestRef.current.generation) {
            return;
          }
          const nextRows = buildApprovalWorkflowRows(
            approvalsResult.items,
            new Map(),
            requesterUsers,
          );
          if (dataset === "pending") {
            setPendingRows(nextRows);
            setPendingCount(approvalsResult.items.length);
            setPendingLoaded(true);
            pendingLoadedRef.current = true;
          } else {
            setHistoryRows(nextRows);
            setHistoryLoaded(true);
            historyLoadedRef.current = true;
          }
        } catch {
          if (dataset === "pending") {
            setPendingError("Failed to load approvals");
          } else {
            setHistoryError("Failed to load approvals");
          }
        } finally {
          if (dataset === "pending") {
            setPendingLoading(false);
          } else {
            setHistoryLoading(false);
          }
        }
      })();
      requestRef.current.inFlight = request;
      try {
        await request;
      } finally {
        if (requestRef.current.inFlight === request) {
          requestRef.current.inFlight = null;
        }
      }
    },
    [canReview, loadRequesterUsers],
  );

  useEffect(() => {
    if (!canReview) return;
    const timer = window.setTimeout(() => {
      void loadApprovals({ dataset: "pending", force: false });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [canReview, loadApprovals]);

  const selectApproval = useCallback(async (approvalId: string) => {
    const requestId = ++detailRequestRef.current;
    deliveryRequestRef.current += 1;
    setSelectedApprovalId(approvalId);
    setDetail(null);
    setIsLoadingDetail(true);
    setDetailError(null);
    setAttachmentsLoadState("loading");
    setAttachmentsLoadError(null);
    try {
      const approvalResult = await fetchApproval(approvalId);
      if (!approvalResult.ok) {
        if (requestId === detailRequestRef.current) {
          setDetailError(approvalResult.error);
          setAttachmentsLoadState("idle");
          setAttachmentsLoadError(null);
        }
        return;
      }
      const [revisionResult, sendResult] = await Promise.all([
        fetchOutboundRevision(approvalResult.item.currentRevisionId),
        fetchSendOperationForApproval(approvalId),
      ]);
      if (!revisionResult.ok) {
        if (requestId === detailRequestRef.current) {
          setDetailError(revisionResult.error);
          setAttachmentsLoadState("error");
          setAttachmentsLoadError(null);
        }
        return;
      }
      if (requestId !== detailRequestRef.current) {
        return;
      }
      const attachmentState = resolveApprovalAttachmentsState(revisionResult.item);
      setAttachmentsLoadState(attachmentState.state);
      setAttachmentsLoadError(attachmentState.errorKey);
      const sendOperation = sendResult.ok ? sendResult.item : null;
      const delivery =
        sendOperation?.status === "accepted"
          ? await (async () => {
              const deliveryResult = await fetchSendOperationDelivery(
                sendOperation.id,
              );
              return deliveryResult.ok ? deliveryResult.item : null;
            })()
          : null;
      setDetail(
        buildDetailView(
          approvalResult.item,
          revisionResult.item,
          buildApprovalRequesterUsersById(usersListRef.current, sessionUser),
          sendOperation,
          delivery,
        ),
      );
    } catch {
      if (requestId === detailRequestRef.current) {
        setDetailError("Failed to load approval detail");
        setAttachmentsLoadState("error");
        setAttachmentsLoadError(null);
      }
    } finally {
      if (requestId === detailRequestRef.current) {
        setIsLoadingDetail(false);
      }
    }
  }, [sessionUser]);

  const clearSelection = useCallback(() => {
    detailRequestRef.current += 1;
    deliveryRequestRef.current += 1;
    setSelectedApprovalId(null);
    setDetail(null);
    setDetailError(null);
    setAttachmentsLoadState("idle");
    setAttachmentsLoadError(null);
    setIsLoadingDetail(false);
  }, []);

  const refreshDetail = useCallback(async () => {
    if (!selectedApprovalId) return;
    await selectApproval(selectedApprovalId);
  }, [selectApproval, selectedApprovalId]);

  const refreshDeliveryStatus = useCallback(async () => {
    const approvalId = selectedApprovalId;
    const currentDetail = detail;
    if (
      !approvalId ||
      !currentDetail ||
      currentDetail.approval.id !== approvalId ||
      currentDetail.approval.status !== "approved"
    ) {
      return;
    }

    const requestId = ++deliveryRequestRef.current;
    const sendResult = await fetchSendOperationForApproval(approvalId);
    if (
      requestId !== deliveryRequestRef.current ||
      selectedApprovalId !== approvalId ||
      !sendResult.ok
    ) {
      return;
    }

    const sendOperation = sendResult.item;
    const delivery =
      sendOperation?.status === "accepted"
        ? await (async () => {
            const deliveryResult = await fetchSendOperationDelivery(
              sendOperation.id,
            );
            return deliveryResult.ok ? deliveryResult.item : null;
          })()
        : null;
    if (
      requestId !== deliveryRequestRef.current ||
      selectedApprovalId !== approvalId
    ) {
      return;
    }

    setDetail((previous) => {
      if (!previous || previous.approval.id !== approvalId) {
        return previous;
      }
      return {
        ...previous,
        sendOperation,
        delivery,
      };
    });
  }, [detail, selectedApprovalId]);

  const value = useMemo(
    (): MailApprovalWorkspaceValue => ({
      rows: pendingRows,
      pendingRows,
      historyRows,
      pendingCount,
      selectedApprovalId,
      detail,
      isLoadingList: pendingLoading,
      pendingLoading,
      historyLoading,
      isLoadingDetail,
      attachmentsLoadState: isLoadingDetail ? "loading" : attachmentsLoadState,
      listError: pendingError,
      pendingError,
      historyError,
      detailError,
      attachmentsLoadError,
      canReview,
      pendingLoaded,
      historyLoaded,
      loadApprovals,
      selectApproval,
      clearSelection,
      refreshDetail,
      refreshDeliveryStatus,
    }),
    [
      pendingRows,
      historyRows,
      pendingCount,
      selectedApprovalId,
      detail,
      pendingLoading,
      historyLoading,
      isLoadingDetail,
      pendingError,
      historyError,
      detailError,
      attachmentsLoadState,
      attachmentsLoadError,
      canReview,
      pendingLoaded,
      historyLoaded,
      loadApprovals,
      selectApproval,
      clearSelection,
      refreshDetail,
      refreshDeliveryStatus,
    ],
  );

  return (
    <MailApprovalWorkspaceContext.Provider value={value}>
      {children}
    </MailApprovalWorkspaceContext.Provider>
  );
}

export function useMailApprovalWorkspace(): MailApprovalWorkspaceValue {
  const value = useContext(MailApprovalWorkspaceContext);
  if (!value) {
    throw new Error(
      "useMailApprovalWorkspace must be used within MailApprovalWorkspaceProvider",
    );
  }
  return value;
}

export function useOptionalMailApprovalWorkspace(): MailApprovalWorkspaceValue | null {
  return useContext(MailApprovalWorkspaceContext);
}
