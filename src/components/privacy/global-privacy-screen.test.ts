import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { transform } from "lightningcss";

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
    assert.match(stylesSource, /background: #e5eaf0/);
    assert.match(stylesSource, /backdrop-filter: blur\(28px\)/);
    assert.match(stylesSource, /z-index: 1000/);
    assert.match(componentSource, /if \(privacyReason === null\) return null/);
    assert.doesNotMatch(componentSource, /privacySurfaceRef|navigatorWithStandalone/);
    assert.doesNotMatch(stylesSource, /\.global-privacy-screen\[data-active="true"\]/);
  });

});

// Exercise the installed production CSS optimizer, not only source spelling.
describe("privacy CSS build contract", () => {
  const start = stylesSource.indexOf("/* Solid by default:");
  const end = stylesSource.indexOf("@media (hover: hover)", start);
  const privacyCss = stylesSource.slice(start, end);
  const optimized = transform({
    filename: "privacy.css",
    code: Buffer.from(privacyCss),
    minify: true,
  }).code.toString();

  it("retains both independent browser blur paths after production optimization", () => {
    assert.match(optimized, /[;{]backdrop-filter:blur\(28px\)/);
    assert.match(optimized, /[;{]-webkit-backdrop-filter:blur\(28px\)/);
    assert.equal((privacyCss.match(/@supports /g) ?? []).length, 2);
  });

  it("starts opaque and provides opaque accessibility overrides in either theme", () => {
    const base = optimized.match(/\.global-privacy-screen\{([^}]+)\}/)?.[1] ?? "";
    assert.match(base, /--privacy-solid:#e5eaf0/);
    assert.match(base, /background:var\(--privacy-solid\)/);
    assert.match(optimized, /prefers-reduced-transparency:reduce/);
    assert.match(optimized, /forced-colors:active/);
    assert.match(optimized, /background:canvas/i);
    assert.doesNotMatch(privacyCss, /forced-color-adjust:\s*none/);
  });

  it("keeps shared full viewport coverage, immediate activation and pointer interception", () => {
    assert.match(optimized, /position:fixed/);
    assert.match(optimized, /inset:0/);
    assert.match(optimized, /pointer-events:auto/);
    assert.doesNotMatch(privacyCss, /transition:|animation:/);
    assert.match(optimized, /echfronthk\.com/);
    assert.match(optimized, /echfront-crm-logo-mask\.png/);
    assert.doesNotMatch(privacyCss, /min-width:|max-width:/);
  });
});
