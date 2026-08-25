import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MailServiceError } from "@/lib/mail/errors";
import { mapPublicMessageReadFailureToNotFound } from "@/lib/mail/message-read-permissions";

describe("mapPublicMessageReadFailureToNotFound", () => {
  it("maps wrong-folder forbidden to not found", () => {
    assert.throws(
      () =>
        mapPublicMessageReadFailureToNotFound(
          MailServiceError.forbidden("Message is not available in this folder"),
        ),
      (error: unknown) =>
        error instanceof MailServiceError &&
        error.status === 404 &&
        error.message === "Message not found",
    );
  });

  it("preserves mail access disabled forbidden", () => {
    const original = MailServiceError.forbidden(
      "Mail access is not enabled for this user",
    );
    assert.throws(
      () => mapPublicMessageReadFailureToNotFound(original),
      (error: unknown) => error === original,
    );
  });
});
