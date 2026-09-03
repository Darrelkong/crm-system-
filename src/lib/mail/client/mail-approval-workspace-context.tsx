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
  editableBodyHtml: string;
  quotedBodyHtml: string | null;
  sendOperation?: SendOperationApiItem | null;
  delivery?: SendDeliveryLifecycleApiItem | null;
};

export type MailApprovalWorkspaceValue = {
  rows: ApprovalWorkflowRow[];
  selectedApprovalId: string | null;
  detail: ApprovalDetailView | null;
  isLoadingList: boolean;
  isLoadingDetail: boolean;
  attachmentsLoadState: ApprovalAttachmentsLoadState;
  listError: string | null;
  detailError: string | null;
  attachmentsLoadError: string | null;
  canReview: boolean;
  loadApprovals: () => Promise<void>;
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

  const loadApprovals = useCallback(async () => {
    setIsLoadingList(true);
    setListError(null);
    try {
      const [approvalsResult, usersResult] = await Promise.all([
        fetchApprovals({
          scope: resolveApprovalWorkspaceListScope(canReview),
          status: "pending",
        }),
        fetchAdminUsersForMailAccess(),
      ]);
      if (!approvalsResult.ok) {
        setListError(approvalsResult.error);
        setRows([]);
        return;
      }
      const users = usersResult.ok ? usersResult.items : [];
      const requesterUsers = enrichApprovalRequesterUsers(users, sessionUser);
      usersListRef.current = requesterUsers;
      const revisionIds = [
        ...new Set(approvalsResult.items.map((item) => item.currentRevisionId)),
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
      setRows(
        buildApprovalWorkflowRows(
          approvalsResult.items,
          revisionsById,
          requesterUsers,
        ),
      );
    } catch {
      setListError("Failed to load approvals");
      setRows([]);
    } finally {
      setIsLoadingList(false);
    }
  }, [canReview, sessionUser]);

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
