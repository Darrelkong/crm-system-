import assert from "node:assert/strict";
import { describe, it } from "node:test";

/**
 * Mirrors login-form.tsx response classification for automated verification.
 * Keep in sync with src/app/(auth)/login/login-form.tsx.
 */
function isJsonContentType(contentType: string | null): boolean {
  return (contentType ?? "").includes("application/json");
}

type LoginSubmitOutcome =
  | "access_reverify"
  | "network_error"
  | "json_error_handler"
  | "json_success";

function classifyLoginSubmitResponse(options: {
  fetchThrew: boolean;
  contentType: string | null;
  jsonParseFailed: boolean;
  ok: boolean;
  errorCode?: string;
}): LoginSubmitOutcome {
  if (options.fetchThrew) {
    return "network_error";
  }

  if (!isJsonContentType(options.contentType)) {
    return "access_reverify";
  }

  if (options.jsonParseFailed) {
    return "access_reverify";
  }

  if (
    !options.ok &&
    options.errorCode === "ACCESS_VERIFICATION_EXPIRED"
  ) {
    return "access_reverify";
  }

  if (options.ok) {
    return "json_success";
  }

  return "json_error_handler";
}

describe("login form response handling", () => {
  it("treats HTML responses as Access reverify instead of network error", () => {
    assert.equal(
      classifyLoginSubmitResponse({
        fetchThrew: false,
        contentType: "text/html; charset=utf-8",
        jsonParseFailed: false,
        ok: true,
      }),
      "access_reverify",
    );
  });

  it("treats JSON parse failures as Access reverify instead of network error", () => {
    assert.equal(
      classifyLoginSubmitResponse({
        fetchThrew: false,
        contentType: "application/json",
        jsonParseFailed: true,
        ok: false,
      }),
      "access_reverify",
    );
  });

  it("keeps JSON ACCESS_VERIFICATION_EXPIRED on the Access reverify path", () => {
    assert.equal(
      classifyLoginSubmitResponse({
        fetchThrew: false,
        contentType: "application/json",
        jsonParseFailed: false,
        ok: false,
        errorCode: "ACCESS_VERIFICATION_EXPIRED",
      }),
      "access_reverify",
    );
  });

  it("routes other JSON login errors to existing handlers", () => {
    assert.equal(
      classifyLoginSubmitResponse({
        fetchThrew: false,
        contentType: "application/json",
        jsonParseFailed: false,
        ok: false,
        errorCode: "ACCOUNT_LOCKED",
      }),
      "json_error_handler",
    );

    assert.equal(
      classifyLoginSubmitResponse({
        fetchThrew: false,
        contentType: "application/json",
        jsonParseFailed: false,
        ok: false,
        errorCode: "UNAUTHORIZED_EMAIL",
      }),
      "json_error_handler",
    );

    assert.equal(
      classifyLoginSubmitResponse({
        fetchThrew: false,
        contentType: "application/json",
        jsonParseFailed: false,
        ok: false,
        errorCode: "IP_EMAIL_RESTRICTED",
      }),
      "json_error_handler",
    );
  });

  it("uses network_error only when fetch throws", () => {
    assert.equal(
      classifyLoginSubmitResponse({
        fetchThrew: true,
        contentType: null,
        jsonParseFailed: false,
        ok: false,
      }),
      "network_error",
    );
  });

  it("allows successful JSON login responses", () => {
    assert.equal(
      classifyLoginSubmitResponse({
        fetchThrew: false,
        contentType: "application/json",
        jsonParseFailed: false,
        ok: true,
      }),
      "json_success",
    );
  });
});
