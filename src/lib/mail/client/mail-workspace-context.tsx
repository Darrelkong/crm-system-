"use client";

import {
  createContext,
  useContext,
  useEffect,
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
import { sortDraftsByRecency } from "@/lib/mail/client/draft-management";
import { MailReadApiError } from "@/lib/mail/client/mail-read-api-errors";
import { MAIL_ACCESS_DISABLED_EVENT } from "@/lib/mail/client/mail-access-revalidation";
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
import { resolveEffectiveMailboxId } from "@/lib/mail/client/mail-workspace-mailbox-selection";

export { resolveEffectiveMailboxId } from "@/lib/mail/client/mail-workspace-mailbox-selection";
export type { ResolveEffectiveMailboxIdInput } from "@/lib/mail/client/mail-workspace-mailbox-selection";

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
  previousFolder?: MailWorkspaceFolder;
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
  refreshDrafts: () => Promise<void>;
  loadMoreMessages: () => Promise<void>;
  selectMailbox: (mailboxId: string) => Promise<void>;
  selectFolder: (folder: MailWorkspaceFolder) => Promise<void>;
  selectMessage: (messageId: string) => Promise<void>;
  clearReadingSelection: () => void;
  clearSensitiveState: () => void;
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

export type MessageFolderCacheKey = `${string}:${MailReadFolder}`;

export function buildMessageFolderCacheKey(
  mailboxId: string,
  folder: MailReadFolder,
): MessageFolderCacheKey {
  return `${mailboxId}:${folder}`;
}

export function isSameFolderMessageRefresh(input: {
  reset: boolean;
  currentMailboxId: string | null;
  currentFolder: MailWorkspaceFolder;
  targetMailboxId: string;
  targetFolder: MailReadFolder;
}): boolean {
  return (
    input.reset &&
    input.currentMailboxId === input.targetMailboxId &&
    input.currentFolder === input.targetFolder
  );
}

export type MessageFolderCacheEntry = {
  messages: MailMessageListView[];
  nextCursor: string | null;
};

export type DraftFolderCacheKey = string;

export function buildDraftFolderCacheKey(mailboxId: string | null): DraftFolderCacheKey {
  return mailboxId ?? "__all__";
}

/** Maps workspace folder to a production message folder for mailbox switch loads. */
export function resolveMailboxMessageLoadFolder(
  folder: MailWorkspaceFolder,
): MailReadFolder | null {
  if (folder === "pending_approval") {
    return null;
  }
  if (folder === "drafts") {
    return "inbox";
  }
  return folder;
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
  const messageFolderCache = new Map<MessageFolderCacheKey, MessageFolderCacheEntry>();
  const draftFolderCache = new Map<DraftFolderCacheKey, DraftApiItem[]>();

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
      refreshDrafts,
      loadMoreMessages,
      selectMailbox,
      selectFolder,
      selectMessage,
      clearReadingSelection,
      clearSensitiveState,
      refreshMessages,
      markMessageRead,
    };
    return snapshot;
  };

  const getSnapshot = (): MailWorkspaceContextValue => snapshot;

  function resolveActiveMailboxId(): string | null {
    return resolveEffectiveMailboxId({
      selectedMailboxId: state.selectedMailboxId,
      mailboxes: state.mailboxes,
    });
  }

  async function ensureSoleMailboxInitialLoad(mailboxes: AccessibleMailboxView[]) {
    if (mailboxes.length !== 1) {
      return;
    }

    const mailboxId = resolveEffectiveMailboxId({
      selectedMailboxId: state.selectedMailboxId,
      mailboxes,
    });
    if (!mailboxId) {
      return;
    }

    const messageFolder = resolveMailboxMessageLoadFolder(state.selectedFolder);
    if (messageFolder === null) {
      setState({ selectedMailboxId: mailboxId });
      return;
    }

    await loadMessages({
      mailboxId,
      folder: messageFolder,
      reset: true,
    });
  }

  async function loadMailboxes() {
    setState({ isLoadingMailboxes: true, error: null });
    try {
      const mailboxes = await api.fetchAccessibleMailboxes();
      setState({ mailboxes, isLoadingMailboxes: false, error: null });
      await ensureSoleMailboxInitialLoad(mailboxes);
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
    const comparisonFolder = input.previousFolder ?? state.selectedFolder;
    const sameFolderRefresh = isSameFolderMessageRefresh({
      reset,
      currentMailboxId: state.selectedMailboxId,
      currentFolder: comparisonFolder,
      targetMailboxId: input.mailboxId,
      targetFolder: input.folder,
    });

    if (
      reset &&
      !sameFolderRefresh &&
      state.selectedMailboxId &&
      comparisonFolder !== "drafts" &&
      comparisonFolder !== "pending_approval"
    ) {
      messageFolderCache.set(
        buildMessageFolderCacheKey(
          state.selectedMailboxId,
          comparisonFolder as MailReadFolder,
        ),
        {
          messages: state.messages,
          nextCursor: state.nextCursor,
        },
      );
    }

    const cachedTarget = reset && !sameFolderRefresh
      ? messageFolderCache.get(
          buildMessageFolderCacheKey(input.mailboxId, input.folder),
        )
      : undefined;

    setState({
      isLoadingMessages: true,
      error: null,
      selectedMailboxId: input.mailboxId,
      selectedFolder: input.folder,
      drafts: [],
      ...(reset
        ? {
            selectedMessageId: null,
            selectedMessage: null,
            isLoadingDetail: false,
            ...(sameFolderRefresh
              ? {}
              : {
                  messages: cachedTarget?.messages ?? [],
                  nextCursor: cachedTarget?.nextCursor ?? null,
                }),
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
        if (requestSequence === messagesRequestSequence) {
          setState({ isLoadingMessages: false });
        }
        return;
      }
      const messages = mergeMessagePage(
        sameFolderRefresh ? state.messages : [],
        page,
        reset,
      );
      messageFolderCache.set(
        buildMessageFolderCacheKey(input.mailboxId, input.folder),
        {
          messages,
          nextCursor: page.nextCursor,
        },
      );
      setState({
        messages,
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
        if (requestSequence === messagesRequestSequence) {
          setState({ isLoadingMessages: false });
        }
        return;
      }
      setState({
        isLoadingMessages: false,
        error: toWorkspaceError(error),
      });
    }
  }

  async function loadMoreMessages() {
    const mailboxId = resolveActiveMailboxId();
    if (
      state.selectedFolder === "drafts" ||
      state.selectedFolder === "pending_approval" ||
      !mailboxId ||
      !state.nextCursor ||
      state.isLoadingMessages
    ) {
      return;
    }

    const requestSequence = ++messagesRequestSequence;
    const request: MessagesRequestContext = {
      mailboxId,
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
        if (requestSequence === messagesRequestSequence) {
          setState({ isLoadingMessages: false });
        }
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
        if (requestSequence === messagesRequestSequence) {
          setState({ isLoadingMessages: false });
        }
        return;
      }
      setState({
        isLoadingMessages: false,
        error: toWorkspaceError(error),
      });
    }
  }

  async function refreshDrafts() {
    if (state.selectedFolder !== "drafts") {
      return;
    }
    const mailboxId = resolveActiveMailboxId();
    const requestSequence = ++draftsRequestSequence;
    try {
      const items = await api.fetchDrafts(
        mailboxId ? { mailboxId } : undefined,
      );
      if (requestSequence !== draftsRequestSequence) {
        return;
      }
      if (state.selectedFolder !== "drafts") {
        return;
      }
      setState({
        drafts: sortDraftsByRecency(items),
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
        error: toWorkspaceError(error),
      });
    }
  }

  async function loadDrafts(previousFolder: MailWorkspaceFolder = state.selectedFolder) {
    const mailboxId = resolveActiveMailboxId();
    const requestSequence = ++draftsRequestSequence;
    const draftCacheKey = buildDraftFolderCacheKey(mailboxId);

    if (
      state.selectedMailboxId &&
      previousFolder !== "drafts" &&
      previousFolder !== "pending_approval"
    ) {
      messageFolderCache.set(
        buildMessageFolderCacheKey(
          state.selectedMailboxId,
          previousFolder as MailReadFolder,
        ),
        {
          messages: state.messages,
          nextCursor: state.nextCursor,
        },
      );
    }

    const cachedDrafts = draftFolderCache.get(draftCacheKey);

    setState({
      isLoadingMessages: true,
      error: null,
      selectedFolder: "drafts",
      messages: [],
      nextCursor: null,
      selectedMessageId: null,
      selectedMessage: null,
      isLoadingDetail: false,
      drafts: cachedDrafts ?? [],
      ...(mailboxId ? { selectedMailboxId: mailboxId } : {}),
    });

    try {
      const items = await api.fetchDrafts(
        mailboxId ? { mailboxId } : undefined,
      );
      if (requestSequence !== draftsRequestSequence) {
        return;
      }
      if (state.selectedFolder !== "drafts") {
        if (requestSequence === draftsRequestSequence) {
          setState({ isLoadingMessages: false });
        }
        return;
      }
      const drafts = sortDraftsByRecency(items);
      draftFolderCache.set(draftCacheKey, drafts);
      setState({
        drafts,
        isLoadingMessages: false,
        error: null,
      });
    } catch (error) {
      if (requestSequence !== draftsRequestSequence) {
        return;
      }
      if (state.selectedFolder !== "drafts") {
        if (requestSequence === draftsRequestSequence) {
          setState({ isLoadingMessages: false });
        }
        return;
      }
      setState({
        isLoadingMessages: false,
        error: toWorkspaceError(error),
      });
    }
  }

  async function selectMailbox(mailboxId: string) {
    const folder = resolveMailboxMessageLoadFolder(state.selectedFolder);
    if (folder === null) {
      setState({
        selectedMailboxId: mailboxId,
        messages: [],
        drafts: [],
        nextCursor: null,
        selectedMessageId: null,
        selectedMessage: null,
        isLoadingMessages: false,
        error: null,
      });
      return;
    }
    await loadMessages({
      mailboxId,
      folder,
      reset: true,
    });
  }

  async function selectFolder(folder: MailWorkspaceFolder) {
    const previousFolder = state.selectedFolder;
    if (folder !== previousFolder) {
      setState({ selectedFolder: folder });
    }
    if (folder === "drafts") {
      await loadDrafts(previousFolder);
      return;
    }
    if (folder === "pending_approval") {
      setState({
        selectedFolder: "pending_approval",
        messages: [],
        drafts: [],
        nextCursor: null,
        selectedMessageId: null,
        selectedMessage: null,
        isLoadingDetail: false,
        isLoadingMessages: false,
        error: null,
      });
      return;
    }
    const mailboxId = resolveActiveMailboxId();
    if (!mailboxId) {
      return;
    }
    await loadMessages({
      mailboxId,
      folder,
      reset: true,
      previousFolder,
    });
  }

  function clearReadingSelection() {
    if (
      !state.selectedMessageId &&
      !state.selectedMessage &&
      !state.isLoadingDetail &&
      state.error === null
    ) {
      return;
    }
    detailRequestSequence += 1;
    setState({
      selectedMessageId: null,
      selectedMessage: null,
      isLoadingDetail: false,
      error: null,
    });
  }

  function clearSensitiveState() {
    if (
      state.mailboxes.length === 0 &&
      state.messages.length === 0 &&
      state.drafts.length === 0 &&
      state.selectedMessageId === null &&
      state.selectedMessage === null &&
      state.error === null &&
      messageFolderCache.size === 0 &&
      draftFolderCache.size === 0
    ) {
      return;
    }
    detailRequestSequence += 1;
    messagesRequestSequence += 1;
    draftsRequestSequence += 1;
    messageFolderCache.clear();
    draftFolderCache.clear();
    state = { ...INITIAL_MAIL_WORKSPACE_STATE };
    rebuildSnapshot();
    notify();
  }

  async function selectMessage(messageId: string) {
    if (
      state.selectedFolder === "drafts" ||
      state.selectedFolder === "pending_approval"
    ) {
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
      if (state.selectedMessageId !== messageId) {
        return;
      }
      setState({
        isLoadingDetail: false,
        error: toWorkspaceError(error),
      });
    }
  }

  async function refreshMessages() {
    if (state.selectedFolder === "pending_approval") {
      return;
    }
    if (state.selectedFolder === "drafts") {
      await loadDrafts();
      return;
    }
    const mailboxId = resolveActiveMailboxId();
    if (!mailboxId) {
      return;
    }
    await loadMessages({
      mailboxId,
      folder: state.selectedFolder,
      reset: true,
    });
  }

  async function markMessageRead(input: MarkMessageReadInput) {
    if (
      state.selectedFolder === "drafts" ||
      state.selectedFolder === "pending_approval"
    ) {
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

  useEffect(() => {
    const clearOnAccessDisabled = () =>
      runtime.getSnapshot().clearSensitiveState();
    window.addEventListener(MAIL_ACCESS_DISABLED_EVENT, clearOnAccessDisabled);
    return () =>
      window.removeEventListener(
        MAIL_ACCESS_DISABLED_EVENT,
        clearOnAccessDisabled,
      );
  }, [runtime]);

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
