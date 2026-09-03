import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const componentSource = readFileSync(
  new URL("./global-privacy-screen.tsx", import.meta.url),
  "utf8",
);
const dashboardLayoutSource = readFileSync(
  new URL("../../app/(dashboard)/layout.tsx", import.meta.url),
  "utf8",
);
const stylesSource = readFileSync(
  new URL("../../app/globals.css", import.meta.url),
  "utf8",
);

describe("global privacy screen", () => {
  it("mounts once at the authenticated dashboard layout boundary", () => {
    assert.match(componentSource, /^"use client";/);
    assert.match(dashboardLayoutSource, /<GlobalPrivacyScreen \/>/);
    assert.doesNotMatch(componentSource, /IdleTimeoutProvider|fetch\(|logout/i);
    assert.doesNotMatch(componentSource, /document\.body\.style/);
  });

  it("covers lifecycle events and desktop idle without high-frequency state updates", () => {
    assert.match(componentSource, /GLOBAL_PRIVACY_IDLE_MS = 120_000/);
    assert.match(componentSource, /min-width: 1024px/);
    assert.match(componentSource, /visibilitychange/);
    assert.match(componentSource, /pagehide/);
    assert.match(componentSource, /pageshow/);
    assert.match(componentSource, /addEventListener\("focus"/);
    assert.match(componentSource, /addEventListener\("blur"/);
    assert.match(componentSource, /"pointermove"/);
    assert.match(componentSource, /activityThrottleRef/);
    assert.match(componentSource, /setTimeout\(\(\) => \{/);
    assert.match(componentSource, /const onBlur = \(\) => \{/);
    assert.match(componentSource, /document\.visibilityState === "hidden"/);
  });

  it("uses the existing circular logo and keeps the overlay presentation-only", () => {
    assert.match(stylesSource, /echfront-crm-logo-mask\.png/);
    assert.match(componentSource, /ECHFRONT<\/span>/);
    assert.doesNotMatch(componentSource, /spinner|lock|重新登入|re-?login/i);
    assert.match(stylesSource, /\.global-privacy-screen\s*\{/);
    assert.match(stylesSource, /position: fixed/);
    assert.match(stylesSource, /background: rgb\(12 20 34 \/ 18%\)/);
    assert.match(stylesSource, /backdrop-filter: blur\(22px\)/);
    assert.match(stylesSource, /z-index: 1000/);
    assert.match(componentSource, /if \(privacyReason === null\) return null/);
    assert.doesNotMatch(componentSource, /privacySurfaceRef|navigatorWithStandalone/);
    assert.doesNotMatch(stylesSource, /\.global-privacy-screen\[data-active="true"\]/);
  });

});
