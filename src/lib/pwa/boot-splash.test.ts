import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  CRM_BOOT_SPLASH_LOADING_TEXT,
  resolveBootSplashLoadingText,
  shouldEnableBootSplash,
} from "./boot-splash";
import { buildBootSplashInitScript } from "./boot-splash-bootstrap";

describe("crm boot splash", () => {
  it("uses static locale loading text without remote locale JSON", () => {
    assert.equal(resolveBootSplashLoadingText("en"), CRM_BOOT_SPLASH_LOADING_TEXT.en);
    assert.equal(
      resolveBootSplashLoadingText("zh-Hant"),
      "正在載入中，請稍候",
    );
    assert.equal(
      resolveBootSplashLoadingText("zh-Hans"),
      "正在加载中，请稍候",
    );
  });

  it("enables splash only for standalone or development preview", () => {
    assert.equal(
      shouldEnableBootSplash({
        standalone: true,
        startupPreview: false,
        allowDevPreview: true,
      }),
      true,
    );
    assert.equal(
      shouldEnableBootSplash({
        standalone: false,
        startupPreview: true,
        allowDevPreview: true,
      }),
      true,
    );
    assert.equal(
      shouldEnableBootSplash({
        standalone: false,
        startupPreview: true,
        allowDevPreview: false,
      }),
      false,
    );
    assert.equal(
      shouldEnableBootSplash({
        standalone: false,
        startupPreview: false,
        allowDevPreview: true,
      }),
      false,
    );
  });

  it("renders server-visible boot splash shell in root layout", () => {
    const layout = readFileSync(
      join(process.cwd(), "src/app/layout.tsx"),
      "utf8",
    );
    const shell = readFileSync(
      join(process.cwd(), "src/components/pwa/crm-boot-splash-shell.tsx"),
      "utf8",
    );
    assert.match(layout, /CrmBootSplashShell/);
    assert.match(layout, /crm-boot-splash-critical/);
    assert.match(shell, /id="crm-boot-splash"/);
    assert.match(shell, /CRM_BOOT_SPLASH_LOGO_SRC/);
    assert.doesNotMatch(shell, /api\/auth/);
  });

  it("does not add artificial production delay in init script", () => {
    const devScript = buildBootSplashInitScript(true);
    const prodScript = buildBootSplashInitScript(false);
    assert.doesNotMatch(devScript, /setTimeout\([^,]+,\s*5000/);
    assert.doesNotMatch(prodScript, /setTimeout\([^,]+,\s*5000/);
    assert.match(prodScript, /allowDevPreview=false/);
  });

  it("does not expose PII fields in boot splash shell", () => {
    const shell = readFileSync(
      join(process.cwd(), "src/components/pwa/crm-boot-splash-shell.tsx"),
      "utf8",
    );
    assert.doesNotMatch(shell, /email/i);
    assert.doesNotMatch(shell, /session/i);
    assert.doesNotMatch(shell, /token/i);
  });
});
