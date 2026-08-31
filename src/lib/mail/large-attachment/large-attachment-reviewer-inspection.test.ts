import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evaluateLargeAttachmentReviewerDownloadEligibility } from "@/lib/mail/large-attachment/large-attachment-reviewer-download-eligibility";
import { assertRevisionLargeAttachmentsInspectableForApproval } from "@/lib/mail/large-attachment/large-attachment-approval-inspection-service";
import { createTemporaryLargeAttachmentLifecycle } from "@/lib/mail/large-attachment/large-attachment-state-machine";

const NOW = "2026-08-30T10:00:00.000Z";

describe("large attachment reviewer inspection policy", () => {
  it("denies expired, missing lifecycle, and non-finalized attachments", () => {
    const lifecycle = createTemporaryLargeAttachmentLifecycle({
      id: "life-1",
      storedFileId: "file-1",
      uploadedAt: NOW,
      declaredContentHash: "a".repeat(64),
      storageVersion: "",
      storageEtag: "etag-1",
      finalizedAt: NOW,
    });

    assert.equal(
      evaluateLargeAttachmentReviewerDownloadEligibility({
        lifecycle: null,
        sizeBytes: 1024,
        trustNowIso: NOW,
      }).ok,
      false,
    );

    assert.equal(
      evaluateLargeAttachmentReviewerDownloadEligibility({
        lifecycle: { ...lifecycle, finalizedAt: null },
        sizeBytes: 1024,
        trustNowIso: NOW,
      }).ok,
      false,
    );

    assert.equal(
      evaluateLargeAttachmentReviewerDownloadEligibility({
        lifecycle: {
          ...lifecycle,
          status: "expired",
        },
        sizeBytes: 1024,
        trustNowIso: NOW,
      }).ok,
      false,
    );
  });

  it("fails closed through assertRevisionLargeAttachmentsInspectableForApproval", async () => {
    const db = {
      select: () => ({
        from: () => ({
          where: async () => [
            {
              id: "rev-att-1",
              deliveryMode: "large_attachment",
              storedFileId: "file-1",
              sizeBytes: 1024,
            },
          ],
        }),
      }),
    };
    const lifecycleQuery = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => [],
          }),
        }),
      }),
    };
    let call = 0;
    const proxyDb = new Proxy(db, {
      get(target, prop, receiver) {
        if (prop === "select") {
          call += 1;
          return call === 1 ? target.select : lifecycleQuery.select;
        }
        return Reflect.get(target, prop, receiver);
      },
    });

    await assert.rejects(
      () =>
        assertRevisionLargeAttachmentsInspectableForApproval(
          proxyDb as never,
          "revision-1",
          NOW,
        ),
      /cannot be inspected/i,
    );
  });
});
