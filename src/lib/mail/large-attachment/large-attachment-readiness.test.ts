import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertLargeAttachmentRuntimeReady,
  LARGE_ATTACHMENT_RUNTIME_ENABLED_ENV,
  LARGE_ATTACHMENT_RUNTIME_NOT_READY_CODE,
} from "@/lib/mail/large-attachment/large-attachment-readiness";
import { authorizeLargeAttachmentUpload } from "@/lib/mail/large-attachment/large-attachment-upload-authorization-service";
import { finalizeLargeAttachmentUpload } from "@/lib/mail/large-attachment/large-attachment-upload-finalize-service";
import { resolveDownloadableOutboundRevisionAttachment } from "@/lib/mail/outbound-revision-attachment-download-service";
import { MailServiceError } from "@/lib/mail/errors";
import type { MailActorContext } from "@/lib/mail/actor-context";

const actor: MailActorContext = {
  userId: "readiness-staff",
  sessionId: null,
  crmRole: "staff",
  mailAccessEnabled: true,
  adminGrants: [],
  audit: { ipAddress: null, userAgent: "readiness-test" },
};

function assertDormant(error: unknown): boolean {
  return (
    error instanceof MailServiceError &&
    error.errorCode === "VALIDATION" &&
    error.metadata?.issueCode === LARGE_ATTACHMENT_RUNTIME_NOT_READY_CODE &&
    !error.message.toLowerCase().includes("sqlite") &&
    !error.message.toLowerCase().includes("table")
  );
}

describe("large attachment runtime readiness", () => {
  it("defaults to disabled and supports explicit enabled test opt-in", () => {
    assert.throws(
      () => assertLargeAttachmentRuntimeReady({ env: {} }),
      assertDormant,
    );
    assert.throws(
      () => assertLargeAttachmentRuntimeReady({ enabled: false }),
      assertDormant,
    );
    assert.doesNotThrow(() =>
      assertLargeAttachmentRuntimeReady({
        env: { [LARGE_ATTACHMENT_RUNTIME_ENABLED_ENV]: "1" },
      }),
    );
  });

  it("rejects authorize before upload-session or R2 work", async () => {
    let presignCalled = false;
    await assert.rejects(
      () =>
        authorizeLargeAttachmentUpload(undefined as never, actor, {
          draftId: "draft",
          authorize: {
            filename: "large.bin",
            mimeType: "application/octet-stream",
            sizeBytes: 4 * 1024 * 1024,
            declaredSha256: "a".repeat(64),
            contentMd5: "1B2M2Y8AsgTpgAmY7PhCfg==",
          },
          ports: {
            runtimeEnabled: false,
            presignPut: async () => {
              presignCalled = true;
              throw new Error("R2 must not be called");
            },
          },
        }),
      assertDormant,
    );
    assert.equal(presignCalled, false);
  });

  it("rejects finalize before upload-session, lifecycle, or R2 work", async () => {
    let headCalled = false;
    await assert.rejects(
      () =>
        finalizeLargeAttachmentUpload(undefined as never, actor, {
          draftId: "draft",
          sessionId: "session",
          expectedAutosaveVersion: 0,
          ports: {
            runtimeEnabled: false,
            headObject: async () => {
              headCalled = true;
              throw new Error("R2 must not be called");
            },
          },
        }),
      assertDormant,
    );
    assert.equal(headCalled, false);
  });

  it("rejects large download before lifecycle lookup", async () => {
    let queryCount = 0;
    const db = {
      select() {
        queryCount += 1;
        return {
          from() {
            return {
              where() {
                return {
                  limit: async () => [{ deliveryMode: "large_attachment" }],
                };
              },
            };
          },
        };
      },
    };

    await assert.rejects(
      () =>
        resolveDownloadableOutboundRevisionAttachment(
          db as never,
          actor,
          "revision",
          "attachment",
          { runtimeEnabled: false },
        ),
      assertDormant,
    );
    assert.equal(queryCount, 1);
  });
});
