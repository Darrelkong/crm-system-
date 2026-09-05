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
import {
  fetchDraftPage as fetchDraftPageFromApi,
  fetchDrafts as fetchDraftsFromApi,
} from "@/lib/mail/client/api";
import {
  fetchOutboxPage,
  fetchOutboxItems,
  type MailOutboxListItem,
  type MailOutboxListPage,
} from "@/lib/mail/client/mail-outbox";
import type {
  DraftApiItem,
  DraftListPage,
} from "@/lib/mail/client/draft-management";
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
  MailboxScope,
  MailReadFolder,
  MailReadStateView,
  MailWorkspaceFolder,
  UpdateMessageReadStateInput,
} from "@/lib/mail/client/mail-read-types";
import { resolveEffectiveMailboxId } from "@/lib/mail/client/mail-workspace-mailbox-selection";
import { normalizeMailWorkspaceFolder } from "@/lib/mail/client/mail-workspace-ui-adapters";

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
  fetchDraftPage?: (input: {
    scope: MailboxScope;
    mailboxId?: string | null;
    cursor?: string | null;
    limit?: number;
    search?: string | null;
  }) => Promise<DraftListPage>;
  fetchOutbox?: (mailboxId?: string | null) => Promise<MailOutboxListItem[]>;
  fetchOutboxPage?: (input: {
    scope: MailboxScope;
    mailboxId?: string | null;
    cursor?: string | null;
    limit?: number;
    search?: string | null;
  }) => Promise<MailOutboxListPage>;
};

export type LoadMessagesInput = {
  scope?: MailboxScope;
  mailboxId?: string | null;
  folder: MailReadFolder;
  reset?: boolean;
  previousFolder?: MailWorkspaceFolder;
  search?: string | null;
};

export type MarkMessageReadInput = {
  messageId: string;
  isRead: boolean;
};

type MailWorkspaceState = {
  mailboxes: AccessibleMailboxView[];
  mailboxScope: MailboxScope;
  selectedMailboxId: string | null;
  selectedFolder: MailWorkspaceFolder;
  messageSearchQuery: string;
  messages: MailMessageListView[];
  drafts: DraftApiItem[];
  outboxItems: MailOutboxListItem[];
  selectedMessageId: string | null;
  selectedMessage: MailMessageDetailView | null;
  nextCursor: string | null;
  isLoadingMailboxes: boolean;
  isLoadingMessages: boolean;
  isLoadingDetail: boolean;
  isLoadingOutbox: boolean;
  outboxNextCursor: string | null;
  isUpdatingReadState: boolean;
  error: MailReadApiError | null;
  outboxError: MailReadApiError | null;
};

export type MailWorkspaceContextValue = MailWorkspaceState & {
  loadMailboxes: () => Promise<void>;
  loadMessages: (input: LoadMessagesInput) => Promise<void>;
  loadDrafts: () => Promise<void>;
  loadMoreDrafts: () => Promise<void>;
  setMessageSearchQuery: (query: string) => Promise<void>;
  refreshDrafts: () => Promise<void>;
  loadMoreMessages: () => Promise<void>;
  selectMailbox: (mailboxId: string) => Promise<void>;
  selectAllMailboxes: () => Promise<void>;
  selectFolder: (folder: MailWorkspaceFolder) => Promise<void>;
  selectMessage: (messageId: string) => Promise<void>;
  clearReadingSelection: () => void;
  clearSensitiveState: () => void;
  refreshMessages: () => Promise<void>;
  markMessageRead: (input: MarkMessageReadInput) => Promise<void>;
  refreshOutbox: () => Promise<void>;
  loadMoreOutbox: () => Promise<void>;
};

export const INITIAL_MAIL_WORKSPACE_STATE: MailWorkspaceState = {
  mailboxes: [],
  mailboxScope: "single",
  selectedMailboxId: null,
  selectedFolder: "inbox",
  messageSearchQuery: "",
  messages: [],
  drafts: [],
  outboxItems: [],
  selectedMessageId: null,
  selectedMessage: null,
  nextCursor: null,
  isLoadingMailboxes: false,
  isLoadingMessages: false,
  isLoadingDetail: false,
  isLoadingOutbox: false,
  outboxNextCursor: null,
  isUpdatingReadState: false,
  error: null,
  outboxError: null,
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
    fetchDraftPage: async (input) => {
      const result = await fetchDraftPageFromApi(input);
      if (!result.ok) {
        throw new MailReadApiError(
          result.status,
          result.error,
          result.errorCode ?? "SERVER_ERROR",
        );
      }
      return result.page;
    },
    fetchOutbox: fetchOutboxItems,
    fetchOutboxPage,
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
  scope?: MailboxScope;
  mailboxId: string | null;
  folder: MailReadFolder;
  search?: string;
};

export function shouldApplyMessagesResponse(input: {
  requestSequence: number;
  activeSequence: number;
  request: MessagesRequestContext;
  currentScope?: MailboxScope;
  currentMailboxId: string | null;
  currentFolder: MailWorkspaceFolder;
  currentSearch?: string;
}): boolean {
  return (
    input.requestSequence === input.activeSequence &&
    (input.currentScope ?? "single") === (input.request.scope ?? "single") &&
    input.currentMailboxId === input.request.mailboxId &&
    input.currentFolder === input.request.folder &&
    (input.currentSearch ?? "") === (input.request.search ?? "")
  );
}

export type MessageFolderCacheKey = `${MailboxScope}:${string}:${MailReadFolder}:${string}`;

export function buildMessageFolderCacheKey(
  scope: MailboxScope,
  mailboxId: string | null,
  folder: MailReadFolder,
  search = "",
): MessageFolderCacheKey {
  return `${scope}:${mailboxId ?? "__all__"}:${folder}:${search}`;
}

export function isSameFolderMessageRefresh(input: {
  reset: boolean;
  currentScope?: MailboxScope;
  currentMailboxId: string | null;
  currentFolder: MailWorkspaceFolder;
  targetScope?: MailboxScope;
  targetMailboxId: string | null;
  targetFolder: MailReadFolder;
  currentSearch?: string;
  targetSearch?: string;
}): boolean {
  return (
    input.reset &&
    (input.currentScope ?? "single") === (input.targetScope ?? "single") &&
    input.currentMailboxId === input.targetMailboxId &&
    input.currentFolder === input.targetFolder &&
    (input.currentSearch ?? "") === (input.targetSearch ?? "")
  );
}

export type MessageFolderCacheEntry = {
  messages: MailMessageListView[];
  nextCursor: string | null;
};

export type DraftFolderCacheKey = `${MailboxScope}:${string}:${string}`;

export function buildDraftFolderCacheKey(
  scope: MailboxScope,
  mailboxId: string | null,
  search = "",
): DraftFolderCacheKey {
  return `${scope}:${mailboxId ?? "__all__"}:${search}`;
}

/** Maps workspace folder to a production message folder for mailbox switch loads. */
export function resolveMailboxMessageLoadFolder(
  folder: MailWorkspaceFolder,
): MailReadFolder | null {
  if (
    folder === "drafts" ||
    folder === "pending_approval" ||
    folder === "outbox"
  ) {
    return null;
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
  let outboxRequestSequence = 0;
  let outboxLoadInFlight: Promise<void> | null = null;
  const messageFolderCache = new Map<MessageFolderCacheKey, MessageFolderCacheEntry>();
  const draftFolderCache = new Map<
    DraftFolderCacheKey,
    { items: DraftApiItem[]; nextCursor: string | null }
  >();

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
      loadMoreDrafts,
      refreshDrafts,
      loadMoreMessages,
      setMessageSearchQuery,
      selectMailbox,
      selectAllMailboxes,
      selectFolder,
      selectMessage,
      clearReadingSelection,
      clearSensitiveState,
      refreshMessages,
      markMessageRead,
      refreshOutbox,
      loadMoreOutbox,
    };
    return snapshot;
  };

  const getSnapshot = (): MailWorkspaceContextValue => snapshot;

  function resolveActiveMailboxId(): string | null {
    if (state.mailboxScope === "all") {
      return null;
    }
    return resolveEffectiveMailboxId({
      selectedMailboxId: state.selectedMailboxId,
      mailboxes: state.mailboxes,
    });
  }

  function resolveActiveScope(): MailboxScope {
    return state.mailboxScope;
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

  async function loadOutbox() {
    if (outboxLoadInFlight) {
      return outboxLoadInFlight;
    }
    const requestSequence = ++outboxRequestSequence;
    const scope = resolveActiveScope();
    const mailboxId = resolveActiveMailboxId();
    setState({ isLoadingOutbox: true, outboxError: null });
    if (!api.fetchOutbox && !api.fetchOutboxPage) {
      setState({ outboxItems: [], outboxNextCursor: null, isLoadingOutbox: false });
      return;
    }
    const request = (async () => {
      try {
        const page = api.fetchOutboxPage
          ? await api.fetchOutboxPage({
              scope,
              mailboxId,
              search: state.messageSearchQuery,
            })
          : {
              items: await api.fetchOutbox!(mailboxId),
              nextCursor: null,
            };
        if (requestSequence !== outboxRequestSequence) {
          return;
        }
        setState({
          outboxItems: page.items,
          outboxNextCursor: page.nextCursor,
          isLoadingOutbox: false,
          outboxError: null,
        });
      } catch (error) {
        if (requestSequence !== outboxRequestSequence) {
          return;
        }
        setState({
          isLoadingOutbox: false,
          outboxError: toWorkspaceError(error),
        });
      }
    })();
    outboxLoadInFlight = request;
    try {
      await request;
    } finally {
      if (outboxLoadInFlight === request) {
        outboxLoadInFlight = null;
      }
    }
  }

  async function refreshOutbox() {
    await loadOutbox();
  }

  async function loadMoreOutbox() {
    if (
      state.isLoadingOutbox ||
      !state.outboxNextCursor ||
      !api.fetchOutboxPage
    ) {
      return;
    }
    const requestSequence = ++outboxRequestSequence;
    const scope = resolveActiveScope();
    const mailboxId = resolveActiveMailboxId();
    setState({ isLoadingOutbox: true, outboxError: null });
    try {
      const page = await api.fetchOutboxPage({
        scope,
        mailboxId,
        cursor: state.outboxNextCursor,
        search: state.messageSearchQuery,
      });
      if (
        requestSequence !== outboxRequestSequence ||
        state.selectedFolder !== "outbox"
      ) {
        return;
      }
      const existingIds = new Set(
        state.outboxItems.map((item) => item.sendOperationId),
      );
      setState({
        outboxItems: [
          ...state.outboxItems,
          ...page.items.filter((item) => !existingIds.has(item.sendOperationId)),
        ],
        outboxNextCursor: page.nextCursor,
        isLoadingOutbox: false,
      });
    } catch (error) {
      if (requestSequence === outboxRequestSequence) {
        setState({
          isLoadingOutbox: false,
          outboxError: toWorkspaceError(error),
        });
      }
    }
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
    const scope = input.scope ?? "single";
    const mailboxId =
      scope === "single"
        ? input.mailboxId ?? resolveEffectiveMailboxId({
            selectedMailboxId: state.selectedMailboxId,
            mailboxes: state.mailboxes,
          })
        : null;
    if (scope === "single" && !mailboxId) {
      return;
    }
    const search = input.search?.trim() ?? state.messageSearchQuery;
    const requestSequence = ++messagesRequestSequence;
    const request: MessagesRequestContext = {
      scope,
      mailboxId,
      folder: input.folder,
      search,
    };
    const comparisonFolder = input.previousFolder ?? state.selectedFolder;
    const sameFolderRefresh = isSameFolderMessageRefresh({
      reset,
      currentScope: state.mailboxScope,
      currentMailboxId:
        state.mailboxScope === "all" ? null : state.selectedMailboxId,
      currentFolder: comparisonFolder,
      targetScope: scope,
      targetMailboxId: mailboxId,
      targetFolder: input.folder,
      currentSearch: state.messageSearchQuery,
      targetSearch: search,
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
          state.mailboxScope,
          state.mailboxScope === "all" ? null : state.selectedMailboxId,
          comparisonFolder as MailReadFolder,
          state.messageSearchQuery,
        ),
        {
          messages: state.messages,
          nextCursor: state.nextCursor,
        },
      );
    }

    const cachedTarget = reset && !sameFolderRefresh
      ? messageFolderCache.get(
          buildMessageFolderCacheKey(scope, mailboxId, input.folder, search),
        )
      : undefined;

    setState({
      isLoadingMessages: true,
      error: null,
      mailboxScope: scope,
      selectedMailboxId:
        scope === "single" ? mailboxId : state.selectedMailboxId,
      selectedFolder: input.folder,
      messageSearchQuery: search,
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
        scope,
        mailboxId: mailboxId ?? "",
        folder: input.folder,
        search,
      });
      if (
        !shouldApplyMessagesResponse({
          requestSequence,
          activeSequence: messagesRequestSequence,
          request,
          currentScope: state.mailboxScope,
          currentMailboxId:
            state.mailboxScope === "all" ? null : state.selectedMailboxId,
          currentFolder: state.selectedFolder,
          currentSearch: state.messageSearchQuery,
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
        buildMessageFolderCacheKey(scope, mailboxId, input.folder, search),
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
          currentScope: state.mailboxScope,
          currentMailboxId:
            state.mailboxScope === "all" ? null : state.selectedMailboxId,
          currentFolder: state.selectedFolder,
          currentSearch: state.messageSearchQuery,
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
    if (state.selectedFolder === "drafts") {
      await loadMoreDrafts();
      return;
    }
    if (state.selectedFolder === "outbox") {
      await loadMoreOutbox();
      return;
    }
    const scope = resolveActiveScope();
    const mailboxId = resolveActiveMailboxId();
    if (
      state.selectedFolder === "pending_approval" ||
      (scope === "single" && !mailboxId) ||
      !state.nextCursor ||
      state.isLoadingMessages
    ) {
      return;
    }

    const requestSequence = ++messagesRequestSequence;
    const folder = state.selectedFolder;
    const request: MessagesRequestContext = {
      scope,
      mailboxId,
      folder,
      search: state.messageSearchQuery,
    };
    const cursor = state.nextCursor;
    const previousMessages = state.messages;

    setState({ isLoadingMessages: true, error: null });
    try {
      const page = await api.fetchMessages({
        scope,
        mailboxId: request.mailboxId ?? "",
        folder: request.folder,
        cursor,
        search: request.search,
      });
      if (
        !shouldApplyMessagesResponse({
          requestSequence,
          activeSequence: messagesRequestSequence,
          request,
          currentScope: state.mailboxScope,
          currentMailboxId:
            state.mailboxScope === "all" ? null : state.selectedMailboxId,
          currentFolder: state.selectedFolder,
          currentSearch: state.messageSearchQuery,
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
          currentScope: state.mailboxScope,
          currentMailboxId:
            state.mailboxScope === "all" ? null : state.selectedMailboxId,
          currentFolder: state.selectedFolder,
          currentSearch: state.messageSearchQuery,
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
    const scope = resolveActiveScope();
    const requestSequence = ++draftsRequestSequence;
    try {
      const page = api.fetchDraftPage
        ? await api.fetchDraftPage({
            scope,
            mailboxId,
            search: state.messageSearchQuery,
          })
        : {
            items: await api.fetchDrafts(
              mailboxId ? { mailboxId } : undefined,
            ),
            nextCursor: null,
          };
      if (requestSequence !== draftsRequestSequence) {
        return;
      }
      if (state.selectedFolder !== "drafts") {
        return;
      }
      setState({
        drafts: sortDraftsByRecency(page.items),
        nextCursor: page.nextCursor,
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

  async function loadDraftsForMailbox(
    mailboxId: string | null,
    previousFolder: MailWorkspaceFolder = state.selectedFolder,
    scope: MailboxScope = state.mailboxScope,
    search = state.messageSearchQuery,
  ) {
    const requestSequence = ++draftsRequestSequence;
    const draftCacheKey = buildDraftFolderCacheKey(
      scope,
      mailboxId,
      search,
    );

    if (
      state.selectedMailboxId &&
      previousFolder !== "drafts" &&
      previousFolder !== "pending_approval"
    ) {
      messageFolderCache.set(
        buildMessageFolderCacheKey(
          state.mailboxScope,
          state.mailboxScope === "all" ? null : state.selectedMailboxId,
          previousFolder as MailReadFolder,
          state.messageSearchQuery,
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
      mailboxScope: scope,
      selectedMailboxId:
        scope === "single" ? mailboxId : state.selectedMailboxId,
      selectedFolder: "drafts",
      messages: [],
      nextCursor: cachedDrafts?.nextCursor ?? null,
      selectedMessageId: null,
      selectedMessage: null,
      isLoadingDetail: false,
      drafts: cachedDrafts?.items ?? [],
    });

    try {
      const page = api.fetchDraftPage
        ? await api.fetchDraftPage({
            scope,
            mailboxId,
            search,
          })
        : {
            items: await api.fetchDrafts(
              mailboxId ? { mailboxId } : undefined,
            ),
            nextCursor: null,
          };
      if (requestSequence !== draftsRequestSequence) {
        return;
      }
      if (state.selectedFolder !== "drafts") {
        if (requestSequence === draftsRequestSequence) {
          setState({ isLoadingMessages: false });
        }
        return;
      }
      const drafts = sortDraftsByRecency(page.items);
      draftFolderCache.set(draftCacheKey, {
        items: drafts,
        nextCursor: page.nextCursor,
      });
      setState({
        drafts,
        nextCursor: page.nextCursor,
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

  async function loadDrafts(
    previousFolder: MailWorkspaceFolder = state.selectedFolder,
  ) {
    await loadDraftsForMailbox(resolveActiveMailboxId(), previousFolder);
  }

  async function loadMoreDrafts() {
    if (
      !state.nextCursor ||
      state.isLoadingMessages ||
      !api.fetchDraftPage ||
      state.selectedFolder !== "drafts"
    ) {
      return;
    }
    const requestSequence = ++draftsRequestSequence;
    const scope = resolveActiveScope();
    const mailboxId = resolveActiveMailboxId();
    setState({ isLoadingMessages: true, error: null });
    try {
      const page = await api.fetchDraftPage({
        scope,
        mailboxId,
        cursor: state.nextCursor,
        search: state.messageSearchQuery,
      });
      if (
        requestSequence !== draftsRequestSequence ||
        state.selectedFolder !== "drafts"
      ) {
        return;
      }
      const existingIds = new Set(state.drafts.map((draft) => draft.id));
      const drafts = sortDraftsByRecency([
        ...state.drafts,
        ...page.items.filter((draft) => !existingIds.has(draft.id)),
      ]);
      setState({
        drafts,
        nextCursor: page.nextCursor,
        isLoadingMessages: false,
        error: null,
      });
    } catch (error) {
      if (requestSequence === draftsRequestSequence) {
        setState({
          isLoadingMessages: false,
          error: toWorkspaceError(error),
        });
      }
    }
  }

  async function setMessageSearchQuery(query: string) {
    const normalized = query.trim();
    setState({ messageSearchQuery: normalized });
    if (state.selectedFolder === "drafts") {
      await loadDraftsForMailbox(
        resolveActiveMailboxId(),
        "drafts",
        resolveActiveScope(),
        normalized,
      );
      return;
    }
    if (state.selectedFolder === "outbox") {
      await loadOutbox();
      return;
    }
    const folder = resolveMailboxMessageLoadFolder(state.selectedFolder);
    if (!folder) {
      return;
    }
    await loadMessages({
      scope: resolveActiveScope(),
      mailboxId: resolveActiveMailboxId(),
      folder,
      reset: true,
      search: normalized,
    });
  }

  async function selectMailbox(mailboxId: string) {
    setState({ mailboxScope: "single", selectedMailboxId: mailboxId });
    if (state.selectedFolder === "outbox") {
      setState({
        mailboxScope: "single",
        selectedMailboxId: mailboxId,
        messages: [],
        drafts: [],
        nextCursor: null,
        selectedMessageId: null,
        selectedMessage: null,
        isLoadingMessages: false,
        error: null,
      });
      await loadOutbox();
      return;
    }

    if (state.selectedFolder === "drafts") {
      await loadDraftsForMailbox(mailboxId, "drafts", "single");
      return;
    }

    const folder = resolveMailboxMessageLoadFolder(state.selectedFolder);
    if (folder === null) {
      setState({
        mailboxScope: "single",
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
      scope: "single",
      mailboxId,
      folder,
      reset: true,
    });
  }

  async function selectAllMailboxes() {
    if (
      state.mailboxes.length < 2 ||
      state.selectedFolder === "pending_approval"
    ) {
      return;
    }
    if (state.selectedFolder === "drafts") {
      await loadDraftsForMailbox(null, "drafts", "all");
      return;
    }
    if (state.selectedFolder === "outbox") {
      setState({
        mailboxScope: "all",
        messages: [],
        drafts: [],
        nextCursor: null,
        selectedMessageId: null,
        selectedMessage: null,
        isLoadingMessages: false,
        error: null,
      });
      await loadOutbox();
      return;
    }
    const folder = resolveMailboxMessageLoadFolder(state.selectedFolder);
    if (folder === null) {
      setState({ mailboxScope: "all" });
      return;
    }
    await loadMessages({
      scope: "all",
      mailboxId: null,
      folder,
      reset: true,
    });
  }

  async function selectFolder(folder: MailWorkspaceFolder) {
    const nextFolder = normalizeMailWorkspaceFolder(folder);
    const previousFolder = state.selectedFolder;
    if (nextFolder !== previousFolder) {
      setState({ selectedFolder: nextFolder });
    }
    if (nextFolder === "drafts") {
      await loadDrafts(previousFolder);
      return;
    }
    if (nextFolder === "outbox") {
      setState({
        selectedFolder: "outbox",
        messages: [],
        drafts: [],
        nextCursor: null,
        selectedMessageId: null,
        selectedMessage: null,
        isLoadingMessages: false,
        error: null,
      });
      await loadOutbox();
      return;
    }
    const mailboxId = resolveActiveMailboxId();
    if (state.mailboxScope === "single" && !mailboxId) {
      return;
    }
    await loadMessages({
      scope: state.mailboxScope,
      mailboxId,
      folder: nextFolder,
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
      state.outboxItems.length === 0 &&
      state.selectedMessageId === null &&
      state.selectedMessage === null &&
      state.error === null &&
      state.outboxError === null &&
      messageFolderCache.size === 0 &&
      draftFolderCache.size === 0
    ) {
      return;
    }
    detailRequestSequence += 1;
    messagesRequestSequence += 1;
    draftsRequestSequence += 1;
    outboxRequestSequence += 1;
    messageFolderCache.clear();
    draftFolderCache.clear();
    state = { ...INITIAL_MAIL_WORKSPACE_STATE };
    rebuildSnapshot();
    notify();
  }

  async function selectMessage(messageId: string) {
    if (
      state.selectedFolder === "drafts" ||
      state.selectedFolder === "pending_approval" ||
      state.selectedFolder === "outbox"
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
    if (state.selectedFolder === "outbox") {
      await loadOutbox();
      return;
    }
    if (state.selectedFolder === "pending_approval") {
      return;
    }
    if (state.selectedFolder === "drafts") {
      await loadDrafts();
      return;
    }
    const mailboxId = resolveActiveMailboxId();
    if (state.mailboxScope === "single" && !mailboxId) {
      return;
    }
    const folder = state.selectedFolder;
    await loadMessages({
      scope: state.mailboxScope,
      mailboxId,
      folder,
      reset: true,
    });
  }

  async function markMessageRead(input: MarkMessageReadInput) {
    if (
      state.selectedFolder === "drafts" ||
      state.selectedFolder === "pending_approval" ||
      state.selectedFolder === "outbox"
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
