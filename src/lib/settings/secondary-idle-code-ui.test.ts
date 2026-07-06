import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applySecondaryIdleCodeDisableSuccess,
  applySecondaryIdleCodeDismissRevealed,
  applySecondaryIdleCodeGenerateSuccess,
  applySecondaryIdleCodeStatusLoad,
  createInitialSecondaryIdleCodeUiState,
  formatSecondaryIdleCodeGeneratedAt,
  getSecondaryIdleCodeStatusLabel,
  parseSecondaryIdleCodeGenerateResponse,
  parseSecondaryIdleCodeGetResponse,
} from "./secondary-idle-code-ui";

describe("secondary idle code UI helpers", () => {
  it("parseSecondaryIdleCodeGetResponse returns enabled/disabled state", () => {
    assert.deepEqual(
      parseSecondaryIdleCodeGetResponse({ enabled: true, generatedAt: "2026-07-06T10:00:00.000Z" }),
      { enabled: true, generatedAt: "2026-07-06T10:00:00.000Z" },
    );
    assert.deepEqual(
      parseSecondaryIdleCodeGetResponse({ enabled: false, generatedAt: null }),
      { enabled: false, generatedAt: null },
    );
  });

  it("parseSecondaryIdleCodeGetResponse ignores hash and plaintext fields", () => {
    const parsed = parseSecondaryIdleCodeGetResponse({
      enabled: true,
      generatedAt: "2026-07-06T10:00:00.000Z",
      hash: "secret-hash",
      plaintext: "Ab12Cd34",
    });
    assert.deepEqual(parsed, {
      enabled: true,
      generatedAt: "2026-07-06T10:00:00.000Z",
    });
    assert.equal("hash" in (parsed ?? {}), false);
    assert.equal("plaintext" in (parsed ?? {}), false);
  });

  it("formatSecondaryIdleCodeGeneratedAt returns 未生成 when empty", () => {
    assert.equal(formatSecondaryIdleCodeGeneratedAt(null), "未生成");
  });

  it("getSecondaryIdleCodeStatusLabel reflects enabled state", () => {
    assert.equal(getSecondaryIdleCodeStatusLabel(true), "已啟用");
    assert.equal(getSecondaryIdleCodeStatusLabel(false), "已停用");
  });

  it("applySecondaryIdleCodeGenerateSuccess reveals plaintext once in state", () => {
    const initial = createInitialSecondaryIdleCodeUiState();
    const next = applySecondaryIdleCodeGenerateSuccess(
      initial,
      "Ab12Cd34",
      "2026-07-06T10:00:00.000Z",
    );
    assert.equal(next.revealedPlaintext, "Ab12Cd34");
    assert.equal(next.status.enabled, true);
    assert.equal(next.status.generatedAt, "2026-07-06T10:00:00.000Z");
    assert.equal(next.disableMessage, null);
  });

  it("applySecondaryIdleCodeDismissRevealed clears plaintext from state", () => {
    const withPlaintext = applySecondaryIdleCodeGenerateSuccess(
      createInitialSecondaryIdleCodeUiState(),
      "Ab12Cd34",
      "2026-07-06T10:00:00.000Z",
    );
    const next = applySecondaryIdleCodeDismissRevealed(withPlaintext);
    assert.equal(next.revealedPlaintext, null);
    assert.equal(next.status.enabled, true);
  });

  it("applySecondaryIdleCodeDisableSuccess clears plaintext and disables feature", () => {
    const withPlaintext = applySecondaryIdleCodeGenerateSuccess(
      createInitialSecondaryIdleCodeUiState(),
      "Ab12Cd34",
      "2026-07-06T10:00:00.000Z",
    );
    const next = applySecondaryIdleCodeDisableSuccess(withPlaintext);
    assert.equal(next.revealedPlaintext, null);
    assert.equal(next.status.enabled, false);
    assert.equal(next.status.generatedAt, null);
    assert.equal(next.disableMessage, "已停止使用二級密碼。");
  });

  it("applySecondaryIdleCodeStatusLoad does not restore plaintext from GET", () => {
    const withPlaintext = applySecondaryIdleCodeGenerateSuccess(
      createInitialSecondaryIdleCodeUiState(),
      "Ab12Cd34",
      "2026-07-06T10:00:00.000Z",
    );
    const dismissed = applySecondaryIdleCodeDismissRevealed(withPlaintext);
    const reloaded = applySecondaryIdleCodeStatusLoad(dismissed, {
      enabled: true,
      generatedAt: "2026-07-06T11:00:00.000Z",
    });
    assert.equal(reloaded.revealedPlaintext, null);
    assert.equal(reloaded.status.generatedAt, "2026-07-06T11:00:00.000Z");
  });

  it("parseSecondaryIdleCodeGenerateResponse returns plaintext or generic error", () => {
    assert.deepEqual(
      parseSecondaryIdleCodeGenerateResponse({ plaintext: "Ab12Cd34" }),
      { plaintext: "Ab12Cd34" },
    );
    assert.deepEqual(
      parseSecondaryIdleCodeGenerateResponse({ error: "權限不足" }),
      { error: "權限不足" },
    );
    assert.deepEqual(
      parseSecondaryIdleCodeGenerateResponse({ hash: "secret" }),
      { error: "生成失敗，請稍後再試。" },
    );
  });
});
