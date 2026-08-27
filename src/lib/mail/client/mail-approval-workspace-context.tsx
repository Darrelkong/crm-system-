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
  fetchOutboundRevision,
} from "@/lib/mail/client/api";
import {
  buildApprovalWorkflowRows,
  canReviewApprovals,
  type ApprovalApiItem,
  type ApprovalWorkflowRow,
  type OutboundRevisionApiItem,
} from "@/lib/mail/client/approval-workflow-management";
import type { MailAccessAdminUser } from "@/lib/mail/client/mail-access-management";
import { splitComposeBodyForEditor } from "@/lib/mail/client/compose-reply-body";
import {
  isApprovalDetailReadyForReview,
  type ApprovalAttachmentsLoadState,
} from "@/lib/mail/client/mail-approval-review-readiness";
import { useMailSession } from "@/lib/mail/client/mail-session-provider";

export type { ApprovalAttachmentsLoadState };
export { isApprovalDetailReadyForReview };

export type ApprovalDetailView = {
  approval: ApprovalApiItem;
  revision: OutboundRevisionApiItem;
  requesterLabel: string;
  editableBodyHtml: string;
  quotedBodyHtml: string | null;
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
};

const MailApprovalWorkspaceContext =
  createContext<MailApprovalWorkspaceValue | null>(null);

function buildDetailView(
  approval: ApprovalApiItem,
  revision: OutboundRevisionApiItem,
  usersById: Map<string, MailAccessAdminUser>,
): ApprovalDetailView {
  const requester = usersById.get(approval.requestedByUserId);
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
    requesterLabel: requester?.name || requester?.email || approval.requestedByUserId,
    editableBodyHtml: split.editableHtml,
    quotedBodyHtml: split.quotedHtml,
  };
}

export function MailApprovalWorkspaceProvider({
  children,
}: {
  children: ReactNode;
}) {
  const { capabilities } = useMailSession();
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
  const usersByIdRef = useRef<Map<string, MailAccessAdminUser>>(new Map());
  const detailRequestRef = useRef(0);

  const loadApprovals = useCallback(async () => {
    setIsLoadingList(true);
    setListError(null);
    try {
      const [approvalsResult, usersResult] = await Promise.all([
        fetchApprovals({ scope: "reviewer", status: "pending" }),
        fetchAdminUsersForMailAccess(),
      ]);
      if (!approvalsResult.ok) {
        setListError(approvalsResult.error);
        setRows([]);
        return;
      }
      const users = usersResult.ok ? usersResult.items : [];
      usersByIdRef.current = new Map(users.map((user) => [user.id, user]));
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
          users,
        ),
      );
    } catch {
      setListError("Failed to load approvals");
      setRows([]);
    } finally {
      setIsLoadingList(false);
    }
  }, []);

  const selectApproval = useCallback(async (approvalId: string) => {
    const requestId = ++detailRequestRef.current;
    setSelectedApprovalId(approvalId);
    setDetail(null);
    setIsLoadingDetail(true);
    setDetailError(null);
    try {
      const approvalResult = await fetchApproval(approvalId);
      if (!approvalResult.ok) {
        if (requestId === detailRequestRef.current) {
          setDetailError(approvalResult.error);
        }
        return;
      }
      const revisionResult = await fetchOutboundRevision(
        approvalResult.item.currentRevisionId,
      );
      if (!revisionResult.ok) {
        if (requestId === detailRequestRef.current) {
          setDetailError(revisionResult.error);
        }
        return;
      }
      if (requestId !== detailRequestRef.current) {
        return;
      }
      setDetail(
        buildDetailView(
          approvalResult.item,
          revisionResult.item,
          usersByIdRef.current,
        ),
      );
    } catch {
      if (requestId === detailRequestRef.current) {
        setDetailError("Failed to load approval detail");
      }
    } finally {
      if (requestId === detailRequestRef.current) {
        setIsLoadingDetail(false);
      }
    }
  }, []);

  const clearSelection = useCallback(() => {
    detailRequestRef.current += 1;
    setSelectedApprovalId(null);
    setDetail(null);
    setDetailError(null);
    setIsLoadingDetail(false);
  }, []);

  const refreshDetail = useCallback(async () => {
    if (!selectedApprovalId) return;
    await selectApproval(selectedApprovalId);
  }, [selectApproval, selectedApprovalId]);

  const value = useMemo(
    (): MailApprovalWorkspaceValue => ({
      rows,
      selectedApprovalId,
      detail,
      isLoadingList,
      isLoadingDetail,
      attachmentsLoadState: isLoadingDetail
        ? "loading"
        : detailError
          ? "error"
          : detail
            ? "loaded"
            : "idle",
      listError,
      detailError,
      attachmentsLoadError: detailError,
      canReview,
      loadApprovals,
      selectApproval,
      clearSelection,
      refreshDetail,
    }),
    [
      rows,
      selectedApprovalId,
      detail,
      isLoadingList,
      isLoadingDetail,
      listError,
      detailError,
      canReview,
      loadApprovals,
      selectApproval,
      clearSelection,
      refreshDetail,
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
