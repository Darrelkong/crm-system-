import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isRecipientDownloadExpired,
} from "./large-attachment-download-token-service";

describe("large attachment download token service policy", () => {
  it("uses the authoritative recipient expiry boundary", () => {
    assert.equal(
      isRecipientDownloadExpired(
        "2026-09-13T08:00:00.000Z",
        "2026-09-13T07:59:59.999Z",
      ),
      false,
    );
    assert.equal(
      isRecipientDownloadExpired(
        "2026-09-13T08:00:00.000Z",
        "2026-09-13T08:00:00.000Z",
      ),
      true,
    );
  });

  it("fails closed for an invalid expiry timestamp", () => {
    assert.equal(
      isRecipientDownloadExpired(
        "not-a-timestamp",
        "2026-09-13T08:00:00.000Z",
      ),
      true,
    );
  });
});
