import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ACCESSIBLE_MAILBOXES_PATH,
  buildMessagesListPath,
  fetchAccessibleMailboxes,
  fetchMessageDetail,
  fetchMessages,
  fetchThread,
  MailReadApiError,
  mapCustomerAssociationView,
  messageDetailPath,
  messageReadStatePath,
  MESSAGES_PATH,
  threadPath,
  updateMessageReadState,
} from "@/lib/mail/client/mail-read-api-client";
import { normalizeMailReadApiError } from "@/lib/mail/client/mail-read-api-errors";
import {
  validateFolder,
  validatePagination,
  validateReadStatePatch,
} from "@/lib/mail/client/mail-read-api-validation";
import type {
  AccessibleMailboxView,
  MailMessageDetailView,
  MailMessageListView,
  MailReadStateView,
  MailThreadView,
} from "@/lib/mail/client/mail-read-types";

function mailboxFixture(): AccessibleMailboxView {
  return {
    id: "mailbox-1",
    address: "staff@example.com",
    displayName: "Staff",
    mailboxType: "personal",
    accessMode: "member",
    permissions: { canRead: true, canReply: false, canSend: false },
  };
}

function listItemFixture(): MailMessageListView {
  return {
    id: "message-1",
    threadId: "thread-1",
    mailboxId: "mailbox-1",
    direction: "inbound",
    sender: { address: "client@example.com", displayName: "Client" },
    subject: "Hello",
    preview: "Preview",
    timestamp: "2026-08-23T08:00:00.000Z",
    isUnread: true,
    isImportantPersonal: false,
    hasAttachments: false,
    attachmentCount: 0,
  };
}

function detailFixture(): MailMessageDetailView {
  return {
    ...listItemFixture(),
    composeMode: null,
    recipients: [
      {
        recipientType: "to",
        address: "to@example.com",
        displayName: null,
        sortOrder: 0,
      },
    ],
    bodyText: "Body",
    bodyHtml: "<p>Body</p>",
    quotedText: null,
    quotedHtml: null,
    receivedAt: "2026-08-23T08:00:00.000Z",
    sentAt: null,
    attachments: [],
    thread: {
      id: "thread-1",
      mailboxId: "mailbox-1",
      subjectNormalized: "hello",
      messageCount: 1,
      latestMessageAt: "2026-08-23T08:00:00.000Z",
    },
    customerAssociation: null,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function errorResponse(
  status: number,
  error: string,
  errorCode?: string,
): Response {
  return jsonResponse({ error, errorCode }, status);
}

describe("mail read api validation", () => {
  it("validates supported folders only", () => {
    assert.equal(validateFolder("inbox"), "inbox");
    assert.throws(() => validateFolder("drafts"), (error: unknown) => {
      return error instanceof MailReadApiError && error.status === 400;
    });
  });

  it("validates pagination limits", () => {
    assert.equal(validatePagination(25), 25);
    assert.throws(() => validatePagination(0), (error: unknown) => {
      return error instanceof MailReadApiError && error.status === 400;
    });
    assert.throws(() => validatePagination(101), (error: unknown) => {
      return error instanceof MailReadApiError && error.status === 400;
    });
  });

  it("validates read-state patch shape", () => {
    assert.deepEqual(validateReadStatePatch({ isRead: true }), {
      isRead: true,
    });
    assert.throws(
      () => validateReadStatePatch({}),
      (error: unknown) =>
        error instanceof MailReadApiError && error.status === 400,
    );
  });
});

describe("mail read api client", () => {
  it("fetchAccessibleMailboxes calls the correct endpoint and maps items", async () => {
    const calls: string[] = [];
    const fetchMock = async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return jsonResponse({ items: [mailboxFixture()] });
    };

    const items = await fetchAccessibleMailboxes({ fetch: fetchMock });
    assert.equal(calls[0], ACCESSIBLE_MAILBOXES_PATH);
    assert.equal(items.length, 1);
    assert.equal(items[0]?.address, "staff@example.com");
  });

  it("fetchMessages builds query parameters with cursor and limit", async () => {
    const calls: string[] = [];
    const fetchMock = async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return jsonResponse({
        items: [listItemFixture()],
        nextCursor: "cursor-2",
      });
    };

    const page = await fetchMessages(
      {
        mailboxId: "mailbox-1",
        folder: "inbox",
        cursor: "cursor-1",
        limit: 25,
      },
      { fetch: fetchMock },
    );

    const url = new URL(calls[0]!, "http://localhost");
    assert.equal(url.pathname, MESSAGES_PATH);
    assert.equal(url.searchParams.get("mailboxId"), "mailbox-1");
    assert.equal(url.searchParams.get("folder"), "inbox");
    assert.equal(url.searchParams.get("cursor"), "cursor-1");
    assert.equal(url.searchParams.get("limit"), "25");
    assert.equal(page.items.length, 1);
    assert.equal(page.nextCursor, "cursor-2");
  });

  it("builds an explicit All Mailboxes message path without a mailbox sentinel", () => {
    assert.equal(
      buildMessagesListPath({
        scope: "all",
        mailboxId: "",
        folder: "inbox",
        search: "client",
      }),
      "/api/mail/messages?folder=inbox&scope=all&q=client",
    );
  });

  it("buildMessagesListPath rejects invalid folder before request", () => {
    assert.throws(
      () =>
        buildMessagesListPath({
          mailboxId: "mailbox-1",
          folder: "drafts" as "inbox",
        }),
      (error: unknown) =>
        error instanceof MailReadApiError && error.status === 400,
    );
  });

  it("fetchMessageDetail includes optional folder context", async () => {
    const calls: string[] = [];
    const fetchMock = async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return jsonResponse({ item: detailFixture() });
    };

    const item = await fetchMessageDetail(
      { messageId: "message-1", folder: "trash" },
      { fetch: fetchMock },
    );

    const url = new URL(calls[0]!, "http://localhost");
    assert.equal(url.pathname, messageDetailPath("message-1"));
    assert.equal(url.searchParams.get("folder"), "trash");
    assert.equal(item.bodyText, "Body");
  });

  it("fetchThread includes mailboxId query parameter", async () => {
    const calls: string[] = [];
    const thread: MailThreadView = {
      thread: detailFixture().thread,
      items: [listItemFixture()],
    };
    const fetchMock = async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return jsonResponse(thread);
    };

    const result = await fetchThread(
      { threadId: "thread-1", mailboxId: "mailbox-1" },
      { fetch: fetchMock },
    );

    const url = new URL(calls[0]!, "http://localhost");
    assert.equal(url.pathname, threadPath("thread-1"));
    assert.equal(url.searchParams.get("mailboxId"), "mailbox-1");
    assert.equal(result.items.length, 1);
  });

  it("updateMessageReadState supports partial patch and folder context", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchMock = async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      const item: MailReadStateView = {
        messageId: "message-1",
        isRead: false,
        isImportantPersonal: true,
        readAt: null,
      };
      return jsonResponse({ item });
    };

    const item = await updateMessageReadState(
      {
        messageId: "message-1",
        patch: { isImportantPersonal: true },
        folder: "trash",
      },
      { fetch: fetchMock },
    );

    const url = new URL(calls[0]!.url, "http://localhost");
    assert.equal(url.pathname, messageReadStatePath("message-1"));
    assert.equal(url.searchParams.get("folder"), "trash");
    assert.equal(calls[0]!.init?.method, "PATCH");
    assert.equal(
      calls[0]!.init?.body,
      JSON.stringify({ isImportantPersonal: true }),
    );
    assert.equal(item.isImportantPersonal, true);
    assert.equal(item.isRead, false);
  });

  it("maps safe customerAssociation fields from detail response", async () => {
    const fetchMock = async () =>
      jsonResponse({
        item: {
          ...detailFixture(),
          customerAssociation: {
            customerId: "cust-1",
            customerCode: "C001",
            name: "Customer One",
            salesStage: "prospect",
            ownerName: "Owner",
            associationType: "manual",
            phone: "secret",
          },
        },
      });

    const item = await fetchMessageDetail(
      { messageId: "message-1" },
      { fetch: fetchMock },
    );
    assert.deepEqual(item.customerAssociation, {
      customerId: "cust-1",
      customerCode: "C001",
      name: "Customer One",
      salesStage: "prospect",
      ownerName: "Owner",
      associationType: "manual",
    });
    assert.equal("phone" in (item.customerAssociation ?? {}), false);
  });

  it("maps null customerAssociation from detail response", async () => {
    const fetchMock = async () =>
      jsonResponse({ item: { ...detailFixture(), customerAssociation: null } });

    const item = await fetchMessageDetail(
      { messageId: "message-1" },
      { fetch: fetchMock },
    );
    assert.equal(item.customerAssociation, null);
  });

  it("maps attachment downloadAvailable explicitly and rejects security fields", async () => {
    const fetchMock = async () =>
      jsonResponse({
        item: {
          ...detailFixture(),
          attachments: [
            {
              id: "attachment-1",
              filename: "invoice.pdf",
              mimeType: "application/pdf",
              sizeBytes: 2048,
              deliveryMode: "direct_attachment",
              sortOrder: 0,
              downloadAvailable: true,
            },
          ],
        },
      });

    const item = await fetchMessageDetail(
      { messageId: "message-1" },
      { fetch: fetchMock },
    );
    assert.equal(item.attachments[0]?.downloadAvailable, true);
    assert.equal(item.attachments[0]?.downloadable, true);

    const rejectSecurityField = async () =>
      fetchMessageDetail(
        { messageId: "message-1" },
        {
          fetch: async () =>
            jsonResponse({
              item: {
                ...detailFixture(),
                attachments: [
                  {
                    id: "attachment-1",
                    filename: "invoice.pdf",
                    mimeType: "application/pdf",
                    sizeBytes: 2048,
                    deliveryMode: "direct_attachment",
                    sortOrder: 0,
                    downloadAvailable: true,
                    securityScanStatus: "clean",
                  },
                ],
              },
            }),
        },
      );

    await assert.rejects(rejectSecurityField, (error: unknown) => {
      return error instanceof MailReadApiError && error.status === 400;
    });
  });

  it("rejects attachment metadata when downloadAvailable is missing", async () => {
    await assert.rejects(
      () =>
        fetchMessageDetail(
          { messageId: "message-1" },
          {
            fetch: async () =>
              jsonResponse({
                item: {
                  ...detailFixture(),
                  attachments: [
                    {
                      id: "attachment-1",
                      filename: "invoice.pdf",
                      mimeType: "application/pdf",
                      sizeBytes: 2048,
                      deliveryMode: "direct_attachment",
                      sortOrder: 0,
                    },
                  ],
                },
              }),
          },
        ),
      (error: unknown) =>
        error instanceof MailReadApiError && error.status === 400,
    );
  });

  it("rejects invalid customerAssociation payloads", () => {
    assert.throws(
      () =>
        mapCustomerAssociationView({
          customerId: "cust-1",
          associationType: "manual",
        }),
      (error: unknown) =>
        error instanceof MailReadApiError && error.status === 400,
    );
  });
});

describe("mail read api error handling", () => {
  it("normalizes 400 responses", async () => {
    const error = await normalizeMailReadApiError(
      errorResponse(400, "Invalid folder", "VALIDATION"),
      "fallback",
    );
    assert.equal(error.status, 400);
    assert.equal(error.code, "VALIDATION");
    assert.equal(error.message, "Invalid folder");
  });

  it("normalizes 401 responses", async () => {
    const error = await normalizeMailReadApiError(
      errorResponse(401, "Unauthorized", "UNAUTHORIZED"),
      "fallback",
    );
    assert.equal(error.status, 401);
    assert.equal(error.code, "UNAUTHORIZED");
  });

  it("normalizes 403 responses", async () => {
    const error = await normalizeMailReadApiError(
      errorResponse(403, "Forbidden", "FORBIDDEN"),
      "fallback",
    );
    assert.equal(error.status, 403);
    assert.equal(error.code, "FORBIDDEN");
  });

  it("normalizes 404 responses", async () => {
    const error = await normalizeMailReadApiError(
      errorResponse(404, "Not found", "NOT_FOUND"),
      "fallback",
    );
    assert.equal(error.status, 404);
    assert.equal(error.code, "NOT_FOUND");
  });

  it("normalizes unknown server errors from fetchAccessibleMailboxes", async () => {
    const fetchMock = async () => errorResponse(500, "服务器错误", "SERVER_ERROR");
    await assert.rejects(
      () => fetchAccessibleMailboxes({ fetch: fetchMock }),
      (error: unknown) =>
        error instanceof MailReadApiError &&
        error.status === 500 &&
        error.code === "SERVER_ERROR",
    );
  });
});
