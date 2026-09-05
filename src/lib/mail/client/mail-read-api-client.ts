import {
  MailReadApiError,
  normalizeMailReadApiError,
  normalizeUnknownMailReadError,
} from "@/lib/mail/client/mail-read-api-errors";
import { isMailCustomerAssociationType } from "@/lib/mail/mail-customer-association-service";
import {
  appendFolderQuery,
  validateFolder,
  validateOptionalFolder,
  validatePagination,
  validateReadStatePatch,
  validateRequiredId,
} from "@/lib/mail/client/mail-read-api-validation";
import type {
  AccessibleMailboxView,
  FetchMessageDetailInput,
  FetchMessagesInput,
  FetchThreadInput,
  MailCustomerAssociationView,
  MailMessageDetailView,
  MailMessageListPage,
  MailReadStateView,
  MailThreadView,
  UpdateMessageReadStateInput,
  MailboxScope,
} from "@/lib/mail/client/mail-read-types";

export const ACCESSIBLE_MAILBOXES_PATH = "/api/mail/mailboxes/accessible";
export const MESSAGES_PATH = "/api/mail/messages";

export function messageDetailPath(messageId: string): string {
  return `/api/mail/messages/${encodeURIComponent(messageId)}`;
}

export function threadPath(threadId: string): string {
  return `/api/mail/threads/${encodeURIComponent(threadId)}`;
}

export function messageReadStatePath(messageId: string): string {
  return `/api/mail/messages/${encodeURIComponent(messageId)}/read-state`;
}

export type MailReadApiFetch = typeof fetch;

export type MailReadApiClientDeps = {
  fetch?: MailReadApiFetch;
};

const defaultDeps: MailReadApiClientDeps = {};

async function mailReadJsonFetch<T>(
  path: string,
  init: RequestInit | undefined,
  fallbackMessage: string,
  deps: MailReadApiClientDeps,
): Promise<T> {
  const fetchFn = deps.fetch ?? fetch;
  try {
    const response = await fetchFn(path, {
      cache: "no-store",
      ...init,
    });
    if (!response.ok) {
      throw await normalizeMailReadApiError(response, fallbackMessage);
    }
    return (await response.json()) as T;
  } catch (error) {
    throw normalizeUnknownMailReadError(error);
  }
}

export function mapAccessibleMailboxesResponse(body: {
  items?: AccessibleMailboxView[];
}): AccessibleMailboxView[] {
  if (!Array.isArray(body.items)) {
    throw MailReadApiError.validation("Invalid accessible mailboxes response");
  }
  return body.items;
}

export function mapMessagesPageResponse(body: {
  items?: MailMessageListPage["items"];
  nextCursor?: string | null;
}): MailMessageListPage {
  if (!Array.isArray(body.items)) {
    throw MailReadApiError.validation("Invalid message list response");
  }
  return {
    items: body.items,
    nextCursor: body.nextCursor ?? null,
  };
}

export function mapCustomerAssociationView(
  value: unknown,
): MailCustomerAssociationView | null {
  if (value == null) {
    return null;
  }
  if (typeof value !== "object") {
    throw MailReadApiError.validation("Invalid customer association response");
  }

  const record = value as Record<string, unknown>;
  const customerId = record.customerId;
  const name = record.name;
  const salesStage = record.salesStage;
  const associationType = record.associationType;

  if (
    typeof customerId !== "string" ||
    !customerId.trim() ||
    typeof name !== "string" ||
    typeof salesStage !== "string" ||
    typeof associationType !== "string" ||
    !isMailCustomerAssociationType(associationType)
  ) {
    throw MailReadApiError.validation("Invalid customer association response");
  }

  const customerCode =
    record.customerCode == null
      ? null
      : typeof record.customerCode === "string"
        ? record.customerCode
        : (() => {
            throw MailReadApiError.validation(
              "Invalid customer association response",
            );
          })();

  const ownerName =
    record.ownerName == null
      ? null
      : typeof record.ownerName === "string"
        ? record.ownerName
        : (() => {
            throw MailReadApiError.validation(
              "Invalid customer association response",
            );
          })();

  return {
    customerId,
    customerCode,
    name,
    salesStage,
    ownerName,
    associationType,
  };
}

function mapAttachmentMetadataView(
  value: unknown,
): MailMessageDetailView["attachments"][number] {
  if (typeof value !== "object" || value == null) {
    throw MailReadApiError.validation("Invalid attachment metadata response");
  }
  const record = value as Record<string, unknown>;
  const id = record.id;
  const filename = record.filename;
  const mimeType = record.mimeType;
  const sizeBytes = record.sizeBytes;
  const deliveryMode = record.deliveryMode;
  const sortOrder = record.sortOrder;
  const downloadAvailable = record.downloadAvailable;
  const downloadable = record.downloadable;
  const previewable = record.previewable;
  const previewType = record.previewType;

  if (
    typeof id !== "string" ||
    !id.trim() ||
    typeof filename !== "string" ||
    typeof mimeType !== "string" ||
    typeof sizeBytes !== "number" ||
    !Number.isFinite(sizeBytes) ||
    (deliveryMode !== "direct_attachment" && deliveryMode !== "secure_file") ||
    typeof sortOrder !== "number" ||
    !Number.isFinite(sortOrder) ||
    typeof downloadAvailable !== "boolean" ||
    (downloadable !== undefined && typeof downloadable !== "boolean") ||
    (previewable !== undefined && typeof previewable !== "boolean") ||
    (previewType !== undefined &&
      previewType !== null &&
      previewType !== "image" &&
      previewType !== "pdf")
  ) {
    throw MailReadApiError.validation("Invalid attachment metadata response");
  }

  if (
    typeof record.securityScanStatus === "string" ||
    typeof record.security_scan_status === "string" ||
    typeof record.storageKey === "string" ||
    typeof record.storedFileId === "string"
  ) {
    throw MailReadApiError.validation("Invalid attachment metadata response");
  }

  return {
    id,
    filename,
    mimeType,
    sizeBytes,
    deliveryMode,
    sortOrder,
    downloadAvailable,
    downloadable:
      typeof downloadable === "boolean" ? downloadable : downloadAvailable,
    previewable: previewable === true,
    previewType:
      previewType === "image" || previewType === "pdf" ? previewType : null,
  };
}

function mapMessageDetailAttachments(
  value: unknown,
): MailMessageDetailView["attachments"] {
  if (!Array.isArray(value)) {
    throw MailReadApiError.validation("Invalid message detail response");
  }
  return value.map(mapAttachmentMetadataView);
}

export function mapMessageDetailResponse(body: {
  item?: MailMessageDetailView & { customerAssociation?: unknown };
}): MailMessageDetailView {
  if (!body.item || typeof body.item !== "object") {
    throw MailReadApiError.validation("Invalid message detail response");
  }

  const { customerAssociation, attachments, ...rest } = body.item;
  if (!Array.isArray(attachments)) {
    throw MailReadApiError.validation("Invalid message detail response");
  }

  return {
    ...rest,
    attachments: mapMessageDetailAttachments(attachments),
    customerAssociation: mapCustomerAssociationView(customerAssociation ?? null),
  };
}

export function mapThreadResponse(body: {
  thread?: MailThreadView["thread"];
  items?: MailThreadView["items"];
}): MailThreadView {
  if (!body.thread || !Array.isArray(body.items)) {
    throw MailReadApiError.validation("Invalid thread response");
  }
  return {
    thread: body.thread,
    items: body.items,
  };
}

export function mapReadStateResponse(body: {
  item?: MailReadStateView;
}): MailReadStateView {
  if (!body.item || typeof body.item !== "object") {
    throw MailReadApiError.validation("Invalid read state response");
  }
  return body.item;
}

export function buildMessagesListPath(input: FetchMessagesInput): string {
  const scope: MailboxScope = input.scope ?? "single";
  const folder = validateFolder(input.folder);
  const limit = validatePagination(input.limit);
  const searchParams = new URLSearchParams({ folder });
  if (scope === "all") {
    searchParams.set("scope", "all");
  } else {
    searchParams.set(
      "mailboxId",
      validateRequiredId(input.mailboxId ?? "", "mailboxId"),
    );
  }
  if (limit != null) {
    searchParams.set("limit", String(limit));
  }
  if (input.cursor) {
    searchParams.set("cursor", input.cursor);
  }
  if (input.search?.trim()) {
    searchParams.set("q", input.search.trim());
  }
  return `${MESSAGES_PATH}?${searchParams.toString()}`;
}

export async function fetchAccessibleMailboxes(
  deps: MailReadApiClientDeps = defaultDeps,
): Promise<AccessibleMailboxView[]> {
  const body = await mailReadJsonFetch<{ items: AccessibleMailboxView[] }>(
    ACCESSIBLE_MAILBOXES_PATH,
    undefined,
    "Failed to load accessible mailboxes",
    deps,
  );
  return mapAccessibleMailboxesResponse(body);
}

export async function fetchMessages(
  input: FetchMessagesInput,
  deps: MailReadApiClientDeps = defaultDeps,
): Promise<MailMessageListPage> {
  const path = buildMessagesListPath(input);
  const body = await mailReadJsonFetch<MailMessageListPage>(
    path,
    undefined,
    "Failed to load messages",
    deps,
  );
  return mapMessagesPageResponse(body);
}

export async function fetchMessageDetail(
  input: FetchMessageDetailInput,
  deps: MailReadApiClientDeps = defaultDeps,
): Promise<MailMessageDetailView> {
  const messageId = validateRequiredId(input.messageId, "messageId");
  const folder = input.folder ? validateFolder(input.folder) : undefined;
  const searchParams = new URLSearchParams();
  appendFolderQuery(searchParams, folder);
  const query = searchParams.toString();
  const path = query
    ? `${messageDetailPath(messageId)}?${query}`
    : messageDetailPath(messageId);

  const body = await mailReadJsonFetch<{ item: MailMessageDetailView }>(
    path,
    undefined,
    "Failed to load message detail",
    deps,
  );
  return mapMessageDetailResponse(body);
}

export async function fetchThread(
  input: FetchThreadInput,
  deps: MailReadApiClientDeps = defaultDeps,
): Promise<MailThreadView> {
  const threadId = validateRequiredId(input.threadId, "threadId");
  const mailboxId = validateRequiredId(input.mailboxId, "mailboxId");
  const searchParams = new URLSearchParams({ mailboxId });
  const path = `${threadPath(threadId)}?${searchParams.toString()}`;

  const body = await mailReadJsonFetch<MailThreadView>(
    path,
    undefined,
    "Failed to load thread",
    deps,
  );
  return mapThreadResponse(body);
}

export async function updateMessageReadState(
  input: UpdateMessageReadStateInput,
  deps: MailReadApiClientDeps = defaultDeps,
): Promise<MailReadStateView> {
  const messageId = validateRequiredId(input.messageId, "messageId");
  const patch = validateReadStatePatch(input.patch);
  const folder = input.folder ? validateFolder(input.folder) : undefined;
  const searchParams = new URLSearchParams();
  appendFolderQuery(searchParams, folder);
  const query = searchParams.toString();
  const path = query
    ? `${messageReadStatePath(messageId)}?${query}`
    : messageReadStatePath(messageId);

  const body = await mailReadJsonFetch<{ item: MailReadStateView }>(
    path,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    },
    "Failed to update message read state",
    deps,
  );
  return mapReadStateResponse(body);
}

export {
  validateFolder,
  validateOptionalFolder,
  validatePagination,
  validateReadStatePatch,
} from "@/lib/mail/client/mail-read-api-validation";

export type {
  AccessibleMailboxView,
  FetchMessageDetailInput,
  FetchMessagesInput,
  FetchThreadInput,
  MailMessageDetailView,
  MailMessageListPage,
  MailMessageListView,
  MailReadFolder,
  MailReadStatePatch,
  MailReadStateView,
  MailThreadView,
  UpdateMessageReadStateInput,
} from "@/lib/mail/client/mail-read-types";

export { MailReadApiError } from "@/lib/mail/client/mail-read-api-errors";
