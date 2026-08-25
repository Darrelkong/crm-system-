"use client";

import {
  createContext,
  useContext,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  fetchAccessibleMailboxes,
  fetchMessageDetail,
  fetchMessages,
  updateMessageReadState,
} from "@/lib/mail/client/mail-read-api-client";
import { fetchDrafts as fetchDraftsFromApi } from "@/lib/mail/client/api";
import type { DraftApiItem } from "@/lib/mail/client/draft-management";
import { MailReadApiError } from "@/lib/mail/client/mail-read-api-errors";
import type {
  AccessibleMailboxView,
  FetchMessageDetailInput,
  FetchMessagesInput,
  MailMessageDetailView,
  MailMessageListPage,
  MailMessageListView,
  MailReadFolder,
  MailReadStateView,
  MailWorkspaceFolder,
  UpdateMessageReadStateInput,
} from "@/lib/mail/client/mail-read-types";

export type MailWorkspaceApi = {
  fetchAccessibleMailboxes: () => Promise<AccessibleMailboxView[]>;
  fetchMessages: (input: FetchMessagesInput) => Promise<MailMessageListPage>;
  fetchMessageDetail: (
    input: FetchMessageDetailInput,
  ) => Promise<MailMessageDetailView>;
  updateMessageReadState: (
    input: UpdateMessageReadStateInput,
  ) => Promise<MailReadStateView>;
  fetchDrafts: (input?: { mailboxId?: string }) => Promise<DraftApiItem[]>;
};

export type LoadMessagesInput = {
  mailboxId: string;
  folder: MailReadFolder;
  reset?: boolean;
};

export type MarkMessageReadInput = {
  messageId: string;
  isRead: boolean;
};

type MailWorkspaceState = {
  mailboxes: AccessibleMailboxView[];
  selectedMailboxId: string | null;
  selectedFolder: MailWorkspaceFolder;
  messages: MailMessageListView[];
  drafts: DraftApiItem[];
  selectedMessageId: string | null;
  selectedMessage: MailMessageDetailView | null;
  nextCursor: string | null;
  isLoadingMailboxes: boolean;
  isLoadingMessages: boolean;
  isLoadingDetail: boolean;
  isUpdatingReadState: boolean;
  error: MailReadApiError | null;
};

export type MailWorkspaceContextValue = MailWorkspaceState & {
  loadMailboxes: () => Promise<void>;
  loadMessages: (input: LoadMessagesInput) => Promise<void>;
  loadDrafts: () => Promise<void>;
  loadMoreMessages: () => Promise<void>;
  selectMailbox: (mailboxId: string) => Promise<void>;
  selectFolder: (folder: MailWorkspaceFolder) => Promise<void>;
  selectMessage: (messageId: string) => Promise<void>;
  refreshMessages: () => Promise<void>;
  markMessageRead: (input: MarkMessageReadInput) => Promise<void>;
};

export const INITIAL_MAIL_WORKSPACE_STATE: MailWorkspaceState = {
  mailboxes: [],
  selectedMailboxId: null,
  selectedFolder: "inbox",
  messages: [],
  drafts: [],
  selectedMessageId: null,
  selectedMessage: null,
  nextCursor: null,
  isLoadingMailboxes: false,
  isLoadingMessages: false,
  isLoadingDetail: false,
  isUpdatingReadState: false,
  error: null,
};

export function createDefaultMailWorkspaceApi(): MailWorkspaceApi {
  return {
    fetchAccessibleMailboxes,
    fetchMessages,
    fetchMessageDetail,
    updateMessageReadState,
    fetchDrafts: async (input) => {
      const result = await fetchDraftsFromApi(input);
      if (!result.ok) {
        throw new MailReadApiError(
          result.status,
          result.error,
          result.errorCode ?? "SERVER_ERROR",
        );
      }
      return result.items;
    },
  };
}

export function mergeMessagePage(
  currentMessages: MailMessageListView[],
  page: MailMessageListPage,
  reset: boolean,
): MailMessageListView[] {
  if (reset) {
    return page.items;
  }
  const existingIds = new Set(currentMessages.map((message) => message.id));
  const appended = page.items.filter((message) => !existingIds.has(message.id));
  return [...currentMessages, ...appended];
}

export function applyReadStateToMessages(
  messages: MailMessageListView[],
  readState: MailReadStateView,
): MailMessageListView[] {
  return messages.map((message) =>
    message.id === readState.messageId
      ? {
          ...message,
          isUnread: !readState.isRead,
          isImportantPersonal: readState.isImportantPersonal,
        }
      : message,
  );
}

export function applyReadStateToDetail(
  detail: MailMessageDetailView | null,
  readState: MailReadStateView,
): MailMessageDetailView | null {
  if (!detail || detail.id !== readState.messageId) {
    return detail;
  }
  return {
    ...detail,
    isUnread: !readState.isRead,
    isImportantPersonal: readState.isImportantPersonal,
  };
}

function toWorkspaceError(error: unknown): MailReadApiError {
  if (error instanceof MailReadApiError) {
    return error;
  }
  return new MailReadApiError(500, "Mail workspace request failed", "SERVER_ERROR");
}

export type MessagesRequestContext = {
  mailboxId: string;
  folder: MailReadFolder;
};

export function shouldApplyMessagesResponse(input: {
  requestSequence: number;
  activeSequence: number;
  request: MessagesRequestContext;
  currentMailboxId: string | null;
  currentFolder: MailWorkspaceFolder;
}): boolean {
  return (
    input.requestSequence === input.activeSequence &&
    input.currentMailboxId === input.request.mailboxId &&
    input.currentFolder === input.request.folder
  );
}

export type MailWorkspaceRuntime = {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => MailWorkspaceContextValue;
};

export function createMailWorkspaceRuntime(
  api: MailWorkspaceApi = createDefaultMailWorkspaceApi(),
): MailWorkspaceRuntime {
  let state: MailWorkspaceState = { ...INITIAL_MAIL_WORKSPACE_STATE };
  const listeners = new Set<() => void>();
  let detailRequestSequence = 0;
  let messagesRequestSequence = 0;
  let draftsRequestSequence = 0;

  const notify = () => {
    for (const listener of listeners) {
      listener();
    }
  };

  const setState = (patch: Partial<MailWorkspaceState>) => {
    state = { ...state, ...patch };
    rebuildSnapshot();
    notify();
  };

  let snapshot: MailWorkspaceContextValue;

  const rebuildSnapshot = (): MailWorkspaceContextValue => {
    snapshot = {
      ...state,
      loadMailboxes,
      loadMessages,
      loadDrafts,
      loadMoreMessages,
      selectMailbox,
      selectFolder,
      selectMessage,
      refreshMessages,
      markMessageRead,
    };
    return snapshot;
  };

  const getSnapshot = (): MailWorkspaceContextValue => snapshot;

  async function loadMailboxes() {
    setState({ isLoadingMailboxes: true, error: null });
    try {
      const mailboxes = await api.fetchAccessibleMailboxes();
      setState({ mailboxes, isLoadingMailboxes: false, error: null });
    } catch (error) {
      setState({
        isLoadingMailboxes: false,
        error: toWorkspaceError(error),
      });
    }
  }

  async function loadMessages(input: LoadMessagesInput) {
    const reset = input.reset !== false;
    const requestSequence = ++messagesRequestSequence;
    const request: MessagesRequestContext = {
      mailboxId: input.mailboxId,
      folder: input.folder,
    };

    setState({
      isLoadingMessages: true,
      error: null,
      selectedMailboxId: input.mailboxId,
      selectedFolder: input.folder,
      ...(reset
        ? {
            messages: [],
            nextCursor: null,
            selectedMessageId: null,
            selectedMessage: null,
          }
        : {}),
    });

    try {
      const page = await api.fetchMessages({
        mailboxId: input.mailboxId,
        folder: input.folder,
      });
      if (
        !shouldApplyMessagesResponse({
          requestSequence,
          activeSequence: messagesRequestSequence,
          request,
          currentMailboxId: state.selectedMailboxId,
          currentFolder: state.selectedFolder,
        })
      ) {
        return;
      }
      setState({
        messages: mergeMessagePage(
          reset ? [] : state.messages,
          page,
          reset,
        ),
        nextCursor: page.nextCursor,
        isLoadingMessages: false,
        error: null,
      });
    } catch (error) {
      if (
        !shouldApplyMessagesResponse({
          requestSequence,
          activeSequence: messagesRequestSequence,
          request,
          currentMailboxId: state.selectedMailboxId,
          currentFolder: state.selectedFolder,
        })
      ) {
        return;
      }
      setState({
        isLoadingMessages: false,
        error: toWorkspaceError(error),
      });
    }
  }

  async function loadMoreMessages() {
    if (
      state.selectedFolder === "drafts" ||
      !state.selectedMailboxId ||
      !state.nextCursor ||
      state.isLoadingMessages
    ) {
      return;
    }

    const requestSequence = ++messagesRequestSequence;
    const request: MessagesRequestContext = {
      mailboxId: state.selectedMailboxId,
      folder: state.selectedFolder,
    };
    const cursor = state.nextCursor;
    const previousMessages = state.messages;

    setState({ isLoadingMessages: true, error: null });
    try {
      const page = await api.fetchMessages({
        mailboxId: request.mailboxId,
        folder: request.folder,
        cursor,
      });
      if (
        !shouldApplyMessagesResponse({
          requestSequence,
          activeSequence: messagesRequestSequence,
          request,
          currentMailboxId: state.selectedMailboxId,
          currentFolder: state.selectedFolder,
        })
      ) {
        return;
      }
      setState({
        messages: mergeMessagePage(previousMessages, page, false),
        nextCursor: page.nextCursor,
        isLoadingMessages: false,
        error: null,
      });
    } catch (error) {
      if (
        !shouldApplyMessagesResponse({
          requestSequence,
          activeSequence: messagesRequestSequence,
          request,
          currentMailboxId: state.selectedMailboxId,
          currentFolder: state.selectedFolder,
        })
      ) {
        return;
      }
      setState({
        isLoadingMessages: false,
        error: toWorkspaceError(error),
      });
    }
  }

  async function loadDrafts() {
    const requestSequence = ++draftsRequestSequence;
    setState({
      isLoadingMessages: true,
      error: null,
      selectedFolder: "drafts",
      messages: [],
      nextCursor: null,
      selectedMessageId: null,
      selectedMessage: null,
    });

    try {
      const items = await api.fetchDrafts(
        state.selectedMailboxId
          ? { mailboxId: state.selectedMailboxId }
          : undefined,
      );
      if (requestSequence !== draftsRequestSequence) {
        return;
      }
      if (state.selectedFolder !== "drafts") {
        return;
      }
      setState({
        drafts: items,
        isLoadingMessages: false,
        error: null,
      });
    } catch (error) {
      if (requestSequence !== draftsRequestSequence) {
        return;
      }
      if (state.selectedFolder !== "drafts") {
        return;
      }
      setState({
        isLoadingMessages: false,
        error: toWorkspaceError(error),
      });
    }
  }

  async function selectMailbox(mailboxId: string) {
    const folder =
      state.selectedFolder === "drafts" ? "inbox" : state.selectedFolder;
    await loadMessages({
      mailboxId,
      folder,
      reset: true,
    });
  }

  async function selectFolder(folder: MailWorkspaceFolder) {
    if (folder === "drafts") {
      await loadDrafts();
      return;
    }
    if (!state.selectedMailboxId) {
      return;
    }
    await loadMessages({
      mailboxId: state.selectedMailboxId,
      folder,
      reset: true,
    });
  }

  async function selectMessage(messageId: string) {
    if (state.selectedFolder === "drafts") {
      return;
    }
    const folder = state.selectedFolder;
    const requestSequence = ++detailRequestSequence;
    setState({
      selectedMessageId: messageId,
      selectedMessage: null,
      isLoadingDetail: true,
      error: null,
    });
    try {
      const item = await api.fetchMessageDetail({
        messageId,
        folder,
      });
      if (requestSequence !== detailRequestSequence) {
        return;
      }
      if (state.selectedMessageId !== messageId) {
        return;
      }
      setState({
        selectedMessage: item,
        isLoadingDetail: false,
        error: null,
      });
    } catch (error) {
      if (requestSequence !== detailRequestSequence) {
        return;
      }
      setState({
        isLoadingDetail: false,
        error: toWorkspaceError(error),
      });
    }
  }

  async function refreshMessages() {
    if (state.selectedFolder === "drafts") {
      await loadDrafts();
      return;
    }
    if (!state.selectedMailboxId) {
      return;
    }
    await loadMessages({
      mailboxId: state.selectedMailboxId,
      folder: state.selectedFolder,
      reset: true,
    });
  }

  async function markMessageRead(input: MarkMessageReadInput) {
    if (state.selectedFolder === "drafts") {
      return;
    }
    setState({ isUpdatingReadState: true, error: null });
    try {
      const readState = await api.updateMessageReadState({
        messageId: input.messageId,
        patch: { isRead: input.isRead },
        folder: state.selectedFolder,
      });
      setState({
        messages: applyReadStateToMessages(state.messages, readState),
        selectedMessage: applyReadStateToDetail(state.selectedMessage, readState),
        isUpdatingReadState: false,
        error: null,
      });
    } catch (error) {
      setState({
        isUpdatingReadState: false,
      });
    }
  }

  rebuildSnapshot();

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot,
  };
}

const MailWorkspaceContext = createContext<MailWorkspaceContextValue | null>(
  null,
);

export type MailWorkspaceProviderProps = {
  children: ReactNode;
  api?: MailWorkspaceApi;
};

export function MailWorkspaceProvider({
  children,
  api,
}: MailWorkspaceProviderProps) {
  const runtime = useMemo(
    () => createMailWorkspaceRuntime(api ?? createDefaultMailWorkspaceApi()),
    [api],
  );
  const value = useSyncExternalStore(
    runtime.subscribe,
    runtime.getSnapshot,
    runtime.getSnapshot,
  );

  return (
    <MailWorkspaceContext.Provider value={value}>
      {children}
    </MailWorkspaceContext.Provider>
  );
}

export function useMailWorkspace(): MailWorkspaceContextValue {
  const value = useContext(MailWorkspaceContext);
  if (!value) {
    throw new Error("useMailWorkspace must be used within MailWorkspaceProvider");
  }
  return value;
}

export function useOptionalMailWorkspace(): MailWorkspaceContextValue | null {
  return useContext(MailWorkspaceContext);
}
