import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import * as schema from "../../../../../drizzle/schema";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import {
  actor,
  fixtureAddress,
  insertMessage,
  makeRequireMailActor,
  setupMailReadApiDb,
  teardownMailReadApiDb,
  type TestDb,
} from "@/app/api/mail/mail-read-route-test-helpers";
import {
  handleGetMailAttachmentContent,
  handleGetMailAttachmentDownload,
} from "@/app/api/mail/attachments/[attachmentId]/download/route";
import {
  MailAttachmentObjectNotFoundError,
  MailAttachmentR2OperationalError,
  MemoryMailAttachmentByteReader,
  type MailAttachmentByteReader,
} from "@/lib/mail/mail-attachment-byte-reader";
import { computeInboundPayloadContentHash } from "@/lib/mail/inbound-payload-hash";
import { MAIL_AUDIT_ACTIONS } from "@/lib/mail/constants";
import { buildMailAttachmentDownloadResponse } from "@/lib/mail/mail-attachment-download-response";
import { AuthError } from "@/lib/permissions/auth";

const FIXTURE = "mail-attachment-route";

function bytes(label: string): Uint8Array {
  return new TextEncoder().encode(`${FIXTURE}:${label}`);
}

const PNG_BYTES = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

async function insertAttachment(
  db: TestDb,
  input: {
    attachmentId: string;
    messageId: string;
    fileBytes?: Uint8Array;
    filename?: string;
    mimeType?: string;
    scanStatus?: "clean" | "unscanned" | "blocked" | "scan_failed";
    deliveryMode?: "direct_attachment" | "secure_file";
  },
) {
  const fileBytes = input.fileBytes ?? bytes(input.attachmentId);
  const filename = input.filename ?? "doc.pdf";
  const mimeType = input.mimeType ?? "application/pdf";
  const contentHash = computeInboundPayloadContentHash(fileBytes);
  const storedFileId = `${input.attachmentId}-file`;
  const storageKey = `mail/test/${storedFileId}`;
  await db.insert(schema.mailStoredFiles).values({
    id: storedFileId,
    contentHash,
    originalFilename: filename,
    mimeType,
    sizeBytes: fileBytes.byteLength,
    storageProvider: "r2",
    storageBucket: "crm-attachments",
    storageKey,
    securityScanStatus: input.scanStatus ?? "clean",
    securityScannedAt:
      (input.scanStatus ?? "clean") === "unscanned"
        ? null
        : new Date().toISOString(),
    createdAt: new Date().toISOString(),
  });
  await db.insert(schema.mailMessageAttachments).values({
    id: input.attachmentId,
    messageId: input.messageId,
    storedFileId,
    contentHash,
    originalFilename: filename,
    displayFilename: filename,
    mimeType,
    sizeBytes: fileBytes.byteLength,
    sortOrder: 0,
    deliveryMode: input.deliveryMode ?? "direct_attachment",
    secureExpiryDays: input.deliveryMode === "secure_file" ? 7 : null,
    createdAt: new Date().toISOString(),
  });
  return { fileBytes, storageKey };
}

class FailingMailAttachmentByteReader implements MailAttachmentByteReader {
  async read(): Promise<Uint8Array> {
    throw new MailAttachmentR2OperationalError();
  }
}

describe("GET /api/mail/attachments/[attachmentId]/download", () => {
  let db: TestDb;
  let dispose: (() => Promise<void>) | undefined;
  let mailboxId: string;
  const r2Objects = new Map<string, Uint8Array>();

  before(async () => {
    const setup = await setupMailReadApiDb();
    db = setup.db;
    dispose = setup.dispose;
    mailboxId = setup.mailboxId;
    r2Objects.clear();
  });

  after(async () => {
    await teardownMailReadApiDb(db, dispose);
    r2Objects.clear();
  });

  function byteReader() {
    return new MemoryMailAttachmentByteReader(r2Objects);
  }

  it("returns 200 with exact bytes for authorized download", async () => {
    const messageId = `${fixtureAddress("route-ok")}-msg`;
    const attachmentId = `${messageId}-att`;
    await insertMessage(db, { id: messageId, mailboxId, direction: "inbound" });
    const { fileBytes, storageKey } = await insertAttachment(db, {
      attachmentId,
      messageId,
    });
    r2Objects.set(storageKey, fileBytes);

    const res = await handleGetMailAttachmentDownload(
      new Request(
        `http://localhost/api/mail/attachments/${attachmentId}/download?folder=inbox`,
      ),
      attachmentId,
      {
        requireMailActor: makeRequireMailActor(db, actor(SEED_IDS.staffA)),
        createByteReader: byteReader,
      },
    );
    assert.equal(res.status, 200);
    const body = new Uint8Array(await res.arrayBuffer());
    assert.deepEqual(body, fileBytes);
    assert.equal(res.headers.get("Cache-Control"), "private, no-store");
    assert.equal(res.headers.get("X-Content-Type-Options"), "nosniff");
    assert.match(res.headers.get("Content-Disposition") ?? "", /^attachment;/);
    assert.equal(res.headers.get("Content-Length"), String(fileBytes.byteLength));
  });

  it("returns an authenticated inline response for a supported image", async () => {
    const messageId = `${fixtureAddress("route-inline")}-msg`;
    const attachmentId = `${messageId}-att`;
    await insertMessage(db, { id: messageId, mailboxId, direction: "inbound" });
    const { fileBytes, storageKey } = await insertAttachment(db, {
      attachmentId,
      messageId,
      fileBytes: PNG_BYTES,
      filename: "preview.png",
      mimeType: "application/octet-stream",
    });
    r2Objects.set(storageKey, fileBytes);

    const res = await handleGetMailAttachmentContent(
      new Request(
        `http://localhost/api/mail/attachments/${attachmentId}/content?folder=inbox&disposition=inline`,
      ),
      attachmentId,
      {
        requireMailActor: makeRequireMailActor(db, actor(SEED_IDS.staffA)),
        createByteReader: byteReader,
      },
    );

    assert.equal(res.status, 200);
    assert.equal(res.headers.get("Content-Type"), "image/png");
    assert.match(res.headers.get("Content-Disposition") ?? "", /^inline;/);
    assert.equal(res.headers.get("X-Content-Type-Options"), "nosniff");
    assert.deepEqual(new Uint8Array(await res.arrayBuffer()), PNG_BYTES);
  });

  it("does not inline unsupported or active content", async () => {
    const messageId = `${fixtureAddress("route-inline-html")}-msg`;
    const attachmentId = `${messageId}-att`;
    const htmlBytes = new TextEncoder().encode("<script>alert(1)</script>");
    await insertMessage(db, { id: messageId, mailboxId, direction: "inbound" });
    const { storageKey, fileBytes } = await insertAttachment(db, {
      attachmentId,
      messageId,
      fileBytes: htmlBytes,
      filename: "page.html",
      mimeType: "text/html",
    });
    r2Objects.set(storageKey, fileBytes);

    const res = await handleGetMailAttachmentContent(
      new Request(
        `http://localhost/api/mail/attachments/${attachmentId}/content?folder=inbox&disposition=inline`,
      ),
      attachmentId,
      {
        requireMailActor: makeRequireMailActor(db, actor(SEED_IDS.staffA)),
        createByteReader: byteReader,
      },
    );

    assert.equal(res.status, 415);
    assert.equal((await res.json()).errorCode, "ATTACHMENT_PREVIEW_NOT_SUPPORTED");
  });

  it("returns 401 when unauthenticated", async () => {
    const res = await handleGetMailAttachmentDownload(
      new Request("http://localhost/api/mail/attachments/x/download"),
      "x",
      {
        requireMailActor: async () => {
          throw new AuthError(401, "未登录");
        },
        createByteReader: byteReader,
      },
    );
    assert.equal(res.status, 401);
  });

  it("returns 403 when mail access is disabled", async () => {
    const messageId = `${fixtureAddress("route-disabled")}-msg`;
    const attachmentId = `${messageId}-att`;
    await insertMessage(db, { id: messageId, mailboxId, direction: "inbound" });
    await insertAttachment(db, { attachmentId, messageId });

    const res = await handleGetMailAttachmentDownload(
      new Request(
        `http://localhost/api/mail/attachments/${attachmentId}/download?folder=inbox`,
      ),
      attachmentId,
      {
        requireMailActor: makeRequireMailActor(
          db,
          actor(SEED_IDS.staffA, { mailAccessEnabled: false }),
        ),
        createByteReader: byteReader,
      },
    );
    assert.equal(res.status, 403);
  });

  it("returns 400 for malformed attachment id", async () => {
    const res = await handleGetMailAttachmentDownload(
      new Request("http://localhost/api/mail/attachments/%20/download"),
      " ",
      {
        requireMailActor: makeRequireMailActor(db, actor(SEED_IDS.staffA)),
        createByteReader: byteReader,
      },
    );
    assert.equal(res.status, 400);
  });

  it("rejects uncontrolled content dispositions", async () => {
    const res = await handleGetMailAttachmentContent(
      new Request("http://localhost/api/mail/attachments/x/content?disposition=javascript"),
      "x",
      {
        requireMailActor: makeRequireMailActor(db, actor(SEED_IDS.staffA)),
        createByteReader: byteReader,
      },
    );
    assert.equal(res.status, 400);
  });

  it("returns 404 for valid missing attachment id", async () => {
    const attachmentId = `${fixtureAddress("missing-att")}`;
    const res = await handleGetMailAttachmentDownload(
      new Request(
        `http://localhost/api/mail/attachments/${attachmentId}/download`,
      ),
      attachmentId,
      {
        requireMailActor: makeRequireMailActor(db, actor(SEED_IDS.staffA)),
        createByteReader: byteReader,
      },
    );
    assert.equal(res.status, 404);
  });

  it("returns 200 for an unscanned normal attachment", async () => {
    const messageId = `${fixtureAddress("route-unscanned")}-msg`;
    const attachmentId = `${messageId}-att`;
    await insertMessage(db, { id: messageId, mailboxId, direction: "inbound" });
    const { storageKey, fileBytes } = await insertAttachment(db, {
      attachmentId,
      messageId,
      scanStatus: "unscanned",
    });
    r2Objects.set(storageKey, fileBytes);

    const res = await handleGetMailAttachmentDownload(
      new Request(
        `http://localhost/api/mail/attachments/${attachmentId}/download?folder=inbox`,
      ),
      attachmentId,
      {
        requireMailActor: makeRequireMailActor(db, actor(SEED_IDS.staffA)),
        createByteReader: byteReader,
      },
    );
    assert.equal(res.status, 200);
  });

  it("returns 404 for secure_file attachment", async () => {
    const messageId = `${fixtureAddress("route-secure")}-msg`;
    const attachmentId = `${messageId}-att`;
    await insertMessage(db, { id: messageId, mailboxId, direction: "inbound" });
    const { storageKey, fileBytes } = await insertAttachment(db, {
      attachmentId,
      messageId,
      deliveryMode: "secure_file",
    });
    r2Objects.set(storageKey, fileBytes);

    const res = await handleGetMailAttachmentDownload(
      new Request(
        `http://localhost/api/mail/attachments/${attachmentId}/download?folder=inbox`,
      ),
      attachmentId,
      {
        requireMailActor: makeRequireMailActor(db, actor(SEED_IDS.staffA)),
        createByteReader: byteReader,
      },
    );
    assert.equal(res.status, 404);
  });

  it("returns 404 for missing R2 object", async () => {
    const messageId = `${fixtureAddress("route-no-r2")}-msg`;
    const attachmentId = `${messageId}-att`;
    await insertMessage(db, { id: messageId, mailboxId, direction: "inbound" });
    await insertAttachment(db, { attachmentId, messageId });

    const res = await handleGetMailAttachmentDownload(
      new Request(
        `http://localhost/api/mail/attachments/${attachmentId}/download?folder=inbox`,
      ),
      attachmentId,
      {
        requireMailActor: makeRequireMailActor(db, actor(SEED_IDS.staffA)),
        createByteReader: byteReader,
      },
    );
    assert.equal(res.status, 404);
    assert.equal((await res.json()).errorCode, "ATTACHMENT_OBJECT_MISSING");
  });

  it("returns 500 for R2 operational failure without leaking internals", async () => {
    const messageId = `${fixtureAddress("route-r2-fail")}-msg`;
    const attachmentId = `${messageId}-att`;
    await insertMessage(db, { id: messageId, mailboxId, direction: "inbound" });
    await insertAttachment(db, { attachmentId, messageId });

    const res = await handleGetMailAttachmentDownload(
      new Request(
        `http://localhost/api/mail/attachments/${attachmentId}/download?folder=inbox`,
      ),
      attachmentId,
      {
        requireMailActor: makeRequireMailActor(db, actor(SEED_IDS.staffA)),
        createByteReader: () => new FailingMailAttachmentByteReader(),
      },
    );
    assert.equal(res.status, 500);
    const json = (await res.json()) as { errorCode: string };
    assert.equal(json.errorCode, "SERVER_ERROR");
  });

  it("returns 200 for trashed message with folder=trash", async () => {
    const messageId = `${fixtureAddress("route-trash-ok")}-msg`;
    const attachmentId = `${messageId}-att`;
    await insertMessage(db, {
      id: messageId,
      mailboxId,
      direction: "inbound",
      trashedAt: new Date().toISOString(),
    });
    const { storageKey, fileBytes } = await insertAttachment(db, {
      attachmentId,
      messageId,
    });
    r2Objects.set(storageKey, fileBytes);

    const res = await handleGetMailAttachmentDownload(
      new Request(
        `http://localhost/api/mail/attachments/${attachmentId}/download?folder=trash`,
      ),
      attachmentId,
      {
        requireMailActor: makeRequireMailActor(db, actor(SEED_IDS.staffA)),
        createByteReader: byteReader,
      },
    );
    assert.equal(res.status, 200);
  });

  it("returns 404 for trashed message with folder=inbox", async () => {
    const messageId = `${fixtureAddress("route-trash-deny")}-msg`;
    const attachmentId = `${messageId}-att`;
    await insertMessage(db, {
      id: messageId,
      mailboxId,
      direction: "inbound",
      trashedAt: new Date().toISOString(),
    });
    const { storageKey, fileBytes } = await insertAttachment(db, {
      attachmentId,
      messageId,
    });
    r2Objects.set(storageKey, fileBytes);

    const res = await handleGetMailAttachmentDownload(
      new Request(
        `http://localhost/api/mail/attachments/${attachmentId}/download?folder=inbox`,
      ),
      attachmentId,
      {
        requireMailActor: makeRequireMailActor(db, actor(SEED_IDS.staffA)),
        createByteReader: byteReader,
      },
    );
    assert.equal(res.status, 404);
  });

  it("emits audit event on successful download only", async () => {
    const messageId = `${fixtureAddress("route-audit")}-msg`;
    const attachmentId = `${messageId}-att`;
    await insertMessage(db, { id: messageId, mailboxId, direction: "inbound" });
    const { storageKey, fileBytes } = await insertAttachment(db, {
      attachmentId,
      messageId,
    });
    r2Objects.set(storageKey, fileBytes);

    const before = await db
      .select()
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.action, MAIL_AUDIT_ACTIONS.attachmentDownloaded));

    const res = await handleGetMailAttachmentDownload(
      new Request(
        `http://localhost/api/mail/attachments/${attachmentId}/download?folder=inbox`,
      ),
      attachmentId,
      {
        requireMailActor: makeRequireMailActor(db, actor(SEED_IDS.staffA)),
        createByteReader: byteReader,
      },
    );
    assert.equal(res.status, 200);

    const after = await db
      .select()
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.action, MAIL_AUDIT_ACTIONS.attachmentDownloaded));
    assert.equal(after.length, before.length + 1);
    const meta = JSON.parse(after.at(-1)?.metadata ?? "{}") as Record<string, unknown>;
    assert.equal(meta.messageId, messageId);
    assert.equal(meta.mailboxId, mailboxId);
    assert.equal("storageKey" in meta, false);

    const denied = await handleGetMailAttachmentDownload(
      new Request(
        `http://localhost/api/mail/attachments/${attachmentId}/download?folder=inbox`,
      ),
      attachmentId,
      {
        requireMailActor: makeRequireMailActor(db, actor(SEED_IDS.staffB)),
        createByteReader: byteReader,
      },
    );
    assert.equal(denied.status, 404);

    const finalAudits = await db
      .select()
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.action, MAIL_AUDIT_ACTIONS.attachmentDownloaded));
    assert.equal(finalAudits.length, after.length);
  });

  it("does not expose recipient or CRM metadata in download response", async () => {
    const messageId = `${fixtureAddress("route-no-meta")}-msg`;
    const attachmentId = `${messageId}-att`;
    await insertMessage(db, {
      id: messageId,
      mailboxId,
      direction: "inbound",
      withBcc: true,
    });
    const { storageKey, fileBytes } = await insertAttachment(db, {
      attachmentId,
      messageId,
    });
    r2Objects.set(storageKey, fileBytes);

    const res = await handleGetMailAttachmentDownload(
      new Request(
        `http://localhost/api/mail/attachments/${attachmentId}/download?folder=inbox`,
      ),
      attachmentId,
      {
        requireMailActor: makeRequireMailActor(db, actor(SEED_IDS.staffA)),
        createByteReader: byteReader,
      },
    );
    assert.equal(res.status, 200);
    const text = new TextDecoder().decode(await res.arrayBuffer());
    assert.equal(text.includes("hidden@example.com"), false);
    assert.equal(text.includes("customerAssociation"), false);
    assert.equal(res.headers.get("storageKey"), null);
  });

  it("maps unknown MIME to octet-stream in response", () => {
    const payload = bytes("unknown-mime");
    const res = buildMailAttachmentDownloadResponse(payload, {
      filename: "file.evil",
      mimeType: "application/x-unknown",
      sizeBytes: payload.byteLength,
    });
    assert.equal(res.headers.get("Content-Type"), "application/octet-stream");
  });
});

describe("MemoryMailAttachmentByteReader", () => {
  it("throws object not found when key is absent", async () => {
    const reader = new MemoryMailAttachmentByteReader(new Map());
    await assert.rejects(
      () => reader.read("missing", 0),
      (error: unknown) => error instanceof MailAttachmentObjectNotFoundError,
    );
  });
});
