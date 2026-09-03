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
  type ApprovalStatus,
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
  pendingCount: number;
  selectedApprovalId: string | null;
  detail: ApprovalDetailView | null;
  isLoadingList: boolean;
  isLoadingDetail: boolean;
  attachmentsLoadState: ApprovalAttachmentsLoadState;
  listError: string | null;
  detailError: string | null;
  attachmentsLoadError: string | null;
  canReview: boolean;
  loadApprovals: (input?: { statuses?: readonly ApprovalStatus[] }) => Promise<void>;
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
  const [rows, setRows] = useState<ApprovalWorkflowRow[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [selectedApprovalId, setSelectedApprovalId] = useState<string | null>(
    null,
  );
  const [detail, setDetail] = useState<ApprovalDetailView | null>(null);
  const [isLoadingList, setIsLoadingList] = useState(false);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [attachmentsLoadState, setAttachmentsLoadState] =
    useState<ApprovalAttachmentsLoadState>("idle");
  const [attachmentsLoadError, setAttachmentsLoadError] = useState<string | null>(
    null,
  );
  const usersListRef = useRef<MailAccessAdminUser[]>([]);
  const detailRequestRef = useRef(0);
  const deliveryRequestRef = useRef(0);
  const sessionUser = session?.user ?? null;

  const loadApprovals = useCallback(
    async (input: { statuses?: readonly ApprovalStatus[] } = {}) => {
      const statuses =
        input.statuses && input.statuses.length > 0
          ? input.statuses
          : (["pending"] as ApprovalStatus[]);
      setIsLoadingList(true);
      setListError(null);
      try {
        const [approvalResults, usersResult] = await Promise.all([
          Promise.all(
            statuses.map((status) =>
              fetchApprovals({
                scope: resolveApprovalWorkspaceListScope(canReview),
                status,
              }),
            ),
          ),
          fetchAdminUsersForMailAccess(),
        ]);
        const failed = approvalResults.find((result) => !result.ok);
        if (failed && !failed.ok) {
          setListError(failed.error);
          setRows([]);
          if (statuses.includes("pending")) {
            setPendingCount(0);
          }
          return;
        }
        const users = usersResult.ok ? usersResult.items : [];
        const requesterUsers = enrichApprovalRequesterUsers(users, sessionUser);
        usersListRef.current = requesterUsers;
        const revisionIds = [
          ...new Set(
            approvalResults.flatMap((result) =>
              result.ok ? result.items.map((item) => item.currentRevisionId) : [],
            ),
          ),
        ];
        const revisionsById = new Map<string, OutboundRevisionApiItem>();
        await Promise.all(
          revisionIds.map(async (revisionId) => {
            const revisionResult = await fetchOutboundRevision(revisionId);
            if (revisionResult.ok) {
              revisionsById.set(revisionId, revisionResult.item);
            }
          }),
        );
        const approvals = approvalResults.flatMap((result) =>
          result.ok ? result.items : [],
        );
        setRows(buildApprovalWorkflowRows(approvals, revisionsById, requesterUsers));
        if (statuses.includes("pending")) {
          setPendingCount(
            approvalResults.reduce(
              (count, result) => count + (result.ok ? result.items.length : 0),
              0,
            ),
          );
        }
      } catch {
        setListError("Failed to load approvals");
        setRows([]);
        if (statuses.includes("pending")) {
          setPendingCount(0);
        }
      } finally {
        setIsLoadingList(false);
      }
    },
    [canReview, sessionUser],
  );

  useEffect(() => {
    if (!canReview) return;
    const timer = window.setTimeout(() => {
      void loadApprovals();
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
      rows,
      pendingCount,
      selectedApprovalId,
      detail,
      isLoadingList,
      isLoadingDetail,
      attachmentsLoadState: isLoadingDetail ? "loading" : attachmentsLoadState,
      listError,
      detailError,
      attachmentsLoadError,
      canReview,
      loadApprovals,
      selectApproval,
      clearSelection,
      refreshDetail,
      refreshDeliveryStatus,
    }),
    [
      rows,
      pendingCount,
      selectedApprovalId,
      detail,
      isLoadingList,
      isLoadingDetail,
      listError,
      detailError,
      attachmentsLoadState,
      attachmentsLoadError,
      canReview,
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
