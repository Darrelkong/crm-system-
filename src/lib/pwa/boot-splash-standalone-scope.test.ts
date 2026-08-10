import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  CRM_BOOT_SPLASH_CRITICAL_CSS,
  shouldCollectStartupTiming,
  shouldEnableBootSplash,
} from "./boot-splash";
import {
  buildBootSplashInitScript,
  CRM_BOOT_SPLASH_INIT_SCRIPT,
} from "./boot-splash-bootstrap";
import { isStandaloneDisplayMode } from "./standalone";
import {
  shouldActivateStartupPreview,
} from "./startup-timing";

function splashVisibleForEnvironment(input: {
  displayModeStandalone: boolean;
  navigatorStandalone?: boolean;
  startupPreview: boolean;
  allowDevPreview: boolean;
}): boolean {
  return shouldEnableBootSplash({
    standalone: isStandaloneDisplayMode({
      displayModeStandalone: input.displayModeStandalone,
      navigatorStandalone: input.navigatorStandalone,
    }),
    startupPreview: input.startupPreview,
    allowDevPreview: input.allowDevPreview,
  });
}

describe("boot splash standalone scope", () => {
  it("shows splash only in standalone mode", () => {
    assert.equal(
      splashVisibleForEnvironment({
        displayModeStandalone: true,
        navigatorStandalone: false,
        startupPreview: false,
        allowDevPreview: true,
      }),
      true,
    );
  });

  it("hides splash in normal iPhone Safari", () => {
    assert.equal(
      splashVisibleForEnvironment({
        displayModeStandalone: false,
        navigatorStandalone: false,
        startupPreview: false,
        allowDevPreview: true,
      }),
      false,
    );
  });

  it("hides splash on desktop Safari", () => {
    assert.equal(
      splashVisibleForEnvironment({
        displayModeStandalone: false,
        navigatorStandalone: false,
        startupPreview: false,
        allowDevPreview: true,
      }),
      false,
    );
  });

  it("hides splash on desktop Chrome", () => {
    assert.equal(
      splashVisibleForEnvironment({
        displayModeStandalone: false,
        startupPreview: false,
        allowDevPreview: true,
      }),
      false,
    );
  });

  it("uses navigator.standalone only as iOS home screen fallback", () => {
    assert.equal(
      splashVisibleForEnvironment({
        displayModeStandalone: false,
        navigatorStandalone: true,
        startupPreview: false,
        allowDevPreview: false,
      }),
      true,
    );
  });

  it("disables startupPreview in production builds", () => {
    const productionScript = buildBootSplashInitScript(false);
    assert.match(productionScript, /allowDevPreview=false/);
    assert.equal(
      shouldActivateStartupPreview(true, false),
      false,
    );
    assert.equal(
      splashVisibleForEnvironment({
        displayModeStandalone: false,
        startupPreview: true,
        allowDevPreview: false,
      }),
      false,
    );
  });

  it("allows startupPreview only in development builds", () => {
    const developmentScript = buildBootSplashInitScript(true);
    assert.match(developmentScript, /allowDevPreview=true/);
    assert.equal(
      shouldActivateStartupPreview(true, true),
      true,
    );
    assert.equal(
      splashVisibleForEnvironment({
        displayModeStandalone: false,
        startupPreview: true,
        allowDevPreview: true,
      }),
      true,
    );
  });

  it("defaults splash CSS to hidden and gates standalone via media query", () => {
    assert.match(CRM_BOOT_SPLASH_CRITICAL_CSS, /display:\s*none\s*!important/);
    assert.match(
      CRM_BOOT_SPLASH_CRITICAL_CSS,
      /@media \(display-mode: standalone\)/,
    );
    assert.match(
      CRM_BOOT_SPLASH_CRITICAL_CSS,
      /crm-boot-splash-ios-standalone/,
    );
    assert.doesNotMatch(
      CRM_BOOT_SPLASH_CRITICAL_CSS,
      /data-crm-boot-splash="visible"/,
    );
  });

  it("collects startup timing only for standalone, dev preview, or debug", () => {
    assert.equal(
      shouldCollectStartupTiming({
        standalone: false,
        startupPreview: false,
        startupDebug: false,
        allowDevPreview: true,
      }),
      false,
    );
    assert.equal(
      shouldCollectStartupTiming({
        standalone: true,
        startupPreview: false,
        startupDebug: false,
        allowDevPreview: false,
      }),
      true,
    );
    assert.equal(
      shouldCollectStartupTiming({
        standalone: false,
        startupPreview: false,
        startupDebug: true,
        allowDevPreview: false,
      }),
      true,
    );
  });

  it("keeps apple startup image metadata for home screen launch only", () => {
    const layout = readFileSync(
      join(process.cwd(), "src/app/layout.tsx"),
      "utf8",
    );
    assert.match(layout, /startupImage/);
    assert.match(layout, /iphone-portrait-1170x2532-light\.png/);
    assert.match(layout, /iphone-portrait-1284x2778-light\.png/);
  });

  it("does not use standalone detection for auth", () => {
    const initScript = CRM_BOOT_SPLASH_INIT_SCRIPT;
    const dismissSource = readFileSync(
      join(process.cwd(), "src/components/pwa/crm-boot-splash-dismiss.tsx"),
      "utf8",
    );
    assert.doesNotMatch(initScript, /auth/i);
    assert.doesNotMatch(initScript, /session/i);
    assert.doesNotMatch(initScript, /permission/i);
    assert.doesNotMatch(dismissSource, /role/i);
  });

  it("does not add production artificial preview delay", () => {
    const productionScript = buildBootSplashInitScript(false);
    assert.doesNotMatch(productionScript, /PREVIEW_MIN_VISIBLE_MS/);
    assert.doesNotMatch(CRM_BOOT_SPLASH_INIT_SCRIPT, /setTimeout\([^,]+,\s*5000/);
  });
});
