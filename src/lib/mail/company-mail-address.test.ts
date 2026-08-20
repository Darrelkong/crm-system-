import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MailServiceError } from "@/lib/mail/errors";
import {
  assertValidEchfrontMailAddress,
  ECHFRONT_MAIL_DOMAIN,
  isReservedEchfrontMailLocalPart,
} from "@/lib/mail/company-mail-address";

describe("assertValidEchfrontMailAddress", () => {
  it("accepts normalized company addresses", () => {
    assert.equal(
      assertValidEchfrontMailAddress("Daniel@ECHFRONTHK.COM"),
      "daniel@echfronthk.com",
    );
    assert.equal(
      assertValidEchfrontMailAddress("  daniel@echfronthk.com  "),
      "daniel@echfronthk.com",
    );
  });

  it("rejects non-company domains", () => {
    assert.throws(
      () => assertValidEchfrontMailAddress("daniel@gmail.com"),
      (error: unknown) =>
        error instanceof MailServiceError && error.errorCode === "VALIDATION",
    );
    assert.throws(
      () => assertValidEchfrontMailAddress("daniel@sub.echfronthk.com"),
      (error: unknown) =>
        error instanceof MailServiceError && error.errorCode === "VALIDATION",
    );
  });

  it("rejects blank local part and malformed addresses", () => {
    assert.throws(
      () => assertValidEchfrontMailAddress("@echfronthk.com"),
      (error: unknown) =>
        error instanceof MailServiceError && error.errorCode === "VALIDATION",
    );
    assert.throws(
      () => assertValidEchfrontMailAddress("not-an-email"),
      (error: unknown) =>
        error instanceof MailServiceError && error.errorCode === "VALIDATION",
    );
  });

  it("preserves plus tags without stripping", () => {
    assert.equal(
      assertValidEchfrontMailAddress("daniel+sales@echfronthk.com"),
      "daniel+sales@echfronthk.com",
    );
  });

  it("rejects reserved local-parts", () => {
    for (const localPart of [
      "admin",
      "support",
      "noreply",
      "ADMIN",
      "Support",
    ]) {
      assert.throws(
        () =>
          assertValidEchfrontMailAddress(`${localPart}@${ECHFRONT_MAIL_DOMAIN}`),
        (error: unknown) =>
          error instanceof MailServiceError &&
          error.errorCode === "VALIDATION",
      );
      assert.equal(
        isReservedEchfrontMailLocalPart(localPart),
        true,
      );
    }
  });

  it("accepts normal unique local parts", () => {
    assert.equal(
      assertValidEchfrontMailAddress("daniel.smith@echfronthk.com"),
      "daniel.smith@echfronthk.com",
    );
  });
});
