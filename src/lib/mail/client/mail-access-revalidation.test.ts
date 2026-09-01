import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isMailAccessDisabledError } from "@/lib/mail/client/mail-access-revalidation";

describe("Mail access revalidation", () => {
  it("recognizes the canonical disabled-access response", () => {
    assert.equal(
      isMailAccessDisabledError({
        status: 403,
        errorCode: "FORBIDDEN",
        error: "Mail access is not enabled for this user",
      }),
      true,
    );
  });

  it("does not treat unrelated forbidden responses as disabled access", () => {
    assert.equal(
      isMailAccessDisabledError({
        status: 403,
        errorCode: "FORBIDDEN",
        error: "Mailbox read permission required",
      }),
      false,
    );
    assert.equal(
      isMailAccessDisabledError({
        status: 409,
        errorCode: "FORBIDDEN",
        error: "Mail access is not enabled for this user",
      }),
      false,
    );
  });
});
