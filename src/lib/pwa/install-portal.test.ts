import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { GET } from "@/app/install/route";
import {
  buildInstallPortalHtml,
  buildInstallPortalManifest,
  buildInstallPortalPlatformDetectorScript,
  classifyInstallPortalPlatform,
  INSTALL_PORTAL_APPLE_TOUCH_ICON,
  INSTALL_PORTAL_COPY,
  INSTALL_PORTAL_CRM_ENTRY_URL,
  INSTALL_PORTAL_ICON_192,
  INSTALL_PORTAL_ICON_512,
  INSTALL_PORTAL_MANIFEST_DESCRIPTION,
  INSTALL_PORTAL_MANIFEST_DISPLAY,
  INSTALL_PORTAL_MANIFEST_ID,
  INSTALL_PORTAL_MANIFEST_NAME,
  INSTALL_PORTAL_MANIFEST_PATH,
  INSTALL_PORTAL_MANIFEST_SCOPE,
  INSTALL_PORTAL_MANIFEST_SHORT_NAME,
  INSTALL_PORTAL_MANIFEST_START_URL,
  resolveInstallPortalLocale,
} from "./install-portal";

const ROOT = process.cwd();

function sha256(filePath: string): string {
  return createHash("sha256")
    .update(readFileSync(filePath))
    .digest("hex");
}

describe("crm install portal document", () => {
  it("returns standalone HTML from /install", async () => {
    const response = await GET(
      new Request("https://crm.echfronthk.com/install", {
        headers: { "accept-language": "en" },
      }),
    );
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.match(
      response.headers.get("content-type") ?? "",
      /text\/html/i,
    );
    assert.match(html, /ECHFRONT CRM/);
    assert.match(html, /rel="manifest" href="\/install\/manifest\.webmanifest"/);
    assert.match(
      html,
      /rel="apple-touch-icon" href="\/install\/apple-touch-icon\.png"/,
    );
    assert.match(html, /href="\/"/);
    assert.doesNotMatch(html, /\/_next\//);
    assert.doesNotMatch(html, /\/api\//);
    assert.doesNotMatch(html, /CF_Authorization/i);
    assert.doesNotMatch(html, /email/i);
    assert.doesNotMatch(html, /session/i);
    assert.match(html, /name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"/);
    assert.doesNotMatch(html, /user-scalable=no/);
    assert.doesNotMatch(html, /maximum-scale=1/);
    assert.match(html, /overflow-x:\s*hidden/);
    assert.match(html, /width:\s*100%/);
    assert.match(html, /@media \(min-width: 40rem\)/);
    assert.match(html, /name="robots" content="noindex, nofollow"/);
  });

  it("does not depend on protected global static paths for core operation", () => {
    const html = buildInstallPortalHtml("zh-Hant");
    assert.doesNotMatch(html, /\/_next\//);
    assert.doesNotMatch(html, /\/api\//);
    assert.match(html, /\/install\/apple-touch-icon\.png/);
    assert.match(html, /\/install\/manifest\.webmanifest/);
    assert.match(html, /<style>/);
    assert.match(html, /<script>/);
  });

  it("defaults to zh-Hant when browser language is unknown", () => {
    assert.equal(resolveInstallPortalLocale(null), "zh-Hant");
    assert.equal(resolveInstallPortalLocale("fr-FR"), "zh-Hant");
  });

  it("resolves English and Chinese locales from accept-language", () => {
    assert.equal(resolveInstallPortalLocale("en-US,en;q=0.9"), "en");
    assert.equal(resolveInstallPortalLocale("zh-Hant-HK,zh;q=0.9"), "zh-Hant");
    assert.equal(resolveInstallPortalLocale("zh-CN,zh;q=0.9"), "zh-Hans");
  });
});

describe("crm install portal manifest", () => {
  it("keeps the same ECHFRONT CRM PWA identity with root start_url", () => {
    const manifest = buildInstallPortalManifest();
    const staticManifest = JSON.parse(
      readFileSync(join(ROOT, "public/install/manifest.webmanifest"), "utf8"),
    );

    assert.equal(manifest.id, INSTALL_PORTAL_MANIFEST_ID);
    assert.equal(manifest.name, INSTALL_PORTAL_MANIFEST_NAME);
    assert.equal(manifest.short_name, INSTALL_PORTAL_MANIFEST_SHORT_NAME);
    assert.equal(manifest.start_url, INSTALL_PORTAL_MANIFEST_START_URL);
    assert.equal(manifest.scope, INSTALL_PORTAL_MANIFEST_SCOPE);
    assert.equal(manifest.display, INSTALL_PORTAL_MANIFEST_DISPLAY);
    assert.equal(manifest.description, INSTALL_PORTAL_MANIFEST_DESCRIPTION);
    assert.equal(staticManifest.description, "ECHFRONT CRM - internal client management");
    assert.doesNotMatch(staticManifest.description, /â€"/);
    assert.equal(manifest.start_url, "/");
    assert.equal(manifest.scope, "/");
    assert.equal(staticManifest.start_url, "/");
    assert.equal(staticManifest.scope, "/");
    assert.equal(staticManifest.id, "https://crm.echfronthk.com/");
    assert.equal(staticManifest.name, "ECHFRONT CRM");
    assert.equal(staticManifest.short_name, "ECHFRONT");
    assert.equal(staticManifest.display, "standalone");
    assert.equal(staticManifest.icons[0].src, INSTALL_PORTAL_ICON_192);
    assert.equal(staticManifest.icons[1].src, INSTALL_PORTAL_ICON_512);
    assert.equal(staticManifest.icons[2].src, INSTALL_PORTAL_APPLE_TOUCH_ICON);
  });
});

describe("crm install portal platform classification", () => {
  it("classifies normal iPhone user agents as ios", () => {
    assert.equal(
      classifyInstallPortalPlatform({
        displayModeStandalone: false,
        userAgent:
          "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
        platform: "iPhone",
        maxTouchPoints: 5,
      }),
      "ios",
    );
  });

  it("classifies older normal iPhone user agents as ios", () => {
    assert.equal(
      classifyInstallPortalPlatform({
        displayModeStandalone: false,
        userAgent:
          "Mozilla/5.0 (iPhone; CPU iPhone OS 13_2_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.0.3 Mobile/15E148 Safari/604.1",
        platform: "iPhone",
        maxTouchPoints: 5,
      }),
      "ios",
    );
  });

  it("classifies normal iPad user agents as ios", () => {
    assert.equal(
      classifyInstallPortalPlatform({
        displayModeStandalone: false,
        userAgent:
          "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
        platform: "iPad",
        maxTouchPoints: 5,
      }),
      "ios",
    );
  });

  it("classifies iPadOS Macintosh user agents with touch as ios", () => {
    assert.equal(
      classifyInstallPortalPlatform({
        displayModeStandalone: false,
        userAgent:
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
        platform: "MacIntel",
        maxTouchPoints: 5,
      }),
      "ios",
    );
  });

  it("classifies Apple mobile desktop-style user agents with touch as ios", () => {
    assert.equal(
      classifyInstallPortalPlatform({
        displayModeStandalone: false,
        userAgent:
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
        platform: "MacIntel",
        maxTouchPoints: 2,
      }),
      "ios",
    );
  });

  it("classifies real Mac Safari without touch as desktop", () => {
    assert.equal(
      classifyInstallPortalPlatform({
        displayModeStandalone: false,
        userAgent:
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
        platform: "MacIntel",
        maxTouchPoints: 0,
      }),
      "desktop",
    );
  });

  it("classifies real Mac Chrome without touch as desktop", () => {
    assert.equal(
      classifyInstallPortalPlatform({
        displayModeStandalone: false,
        userAgent:
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        platform: "MacIntel",
        maxTouchPoints: 0,
      }),
      "desktop",
    );
  });

  it("classifies Windows desktop browsers as desktop", () => {
    assert.equal(
      classifyInstallPortalPlatform({
        displayModeStandalone: false,
        userAgent:
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        platform: "Win32",
        maxTouchPoints: 0,
      }),
      "desktop",
    );
  });

  it("does not classify Windows touchscreen devices as ios", () => {
    assert.equal(
      classifyInstallPortalPlatform({
        displayModeStandalone: false,
        userAgent:
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        platform: "Win32",
        maxTouchPoints: 10,
      }),
      "desktop",
    );
  });

  it("classifies Linux desktop browsers as desktop", () => {
    assert.equal(
      classifyInstallPortalPlatform({
        displayModeStandalone: false,
        userAgent:
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        platform: "Linux x86_64",
        maxTouchPoints: 0,
      }),
      "desktop",
    );
  });

  it("classifies Android Chrome as android", () => {
    assert.equal(
      classifyInstallPortalPlatform({
        displayModeStandalone: false,
        userAgent:
          "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
        platform: "Linux armv8l",
        maxTouchPoints: 5,
      }),
      "android",
    );
  });

  it("classifies Android tablets as android", () => {
    assert.equal(
      classifyInstallPortalPlatform({
        displayModeStandalone: false,
        userAgent:
          "Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        platform: "Linux armv8l",
        maxTouchPoints: 5,
      }),
      "android",
    );
  });

  it("classifies standalone iOS as standalone", () => {
    assert.equal(
      classifyInstallPortalPlatform({
        displayModeStandalone: true,
        navigatorStandalone: true,
        userAgent:
          "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
        platform: "iPhone",
        maxTouchPoints: 5,
      }),
      "standalone",
    );
  });

  it("classifies standalone Android as standalone", () => {
    assert.equal(
      classifyInstallPortalPlatform({
        displayModeStandalone: true,
        userAgent:
          "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
        platform: "Linux armv8l",
        maxTouchPoints: 5,
      }),
      "standalone",
    );
  });

  it("embeds the same detector logic in the standalone HTML script", () => {
    const html = buildInstallPortalHtml("en");
    assert.match(html, /function detectPlatform\(\)/);
    assert.match(html, /maxTouchPoints/);
    assert.match(html, /Macintosh/i);
    assert.match(html, /MacIntel/);
    assert.match(html, /iPhone\|iPad\|iPod/);
    assert.match(html, /Android/i);
    assert.equal(
      buildInstallPortalPlatformDetectorScript().includes("maxTouchPoints > 1"),
      true,
    );
  });
});

describe("crm install portal platform behavior", () => {
  const source = readFileSync(
    join(ROOT, "src/lib/pwa/install-portal.ts"),
    "utf8",
  );

  it("supports iOS, Android, desktop, and standalone categories", () => {
    assert.match(source, /classifyInstallPortalPlatform/);
    assert.match(source, /return "ios"/);
    assert.match(source, /return "android"/);
    assert.match(source, /return "desktop"/);
    assert.match(source, /return "standalone"/);
    assert.match(source, /display-mode: standalone/);
    assert.match(source, /navigator\.standalone/);
    assert.match(source, /maxTouchPoints > 1/);
  });

  it("uses beforeinstallprompt progressive enhancement with manual fallback", () => {
    assert.match(source, /beforeinstallprompt/);
    assert.match(source, /deferredPrompt/);
    assert.match(source, /showAndroidFallback/);
    assert.match(source, /android-fallback/);
  });

  it("keeps CRM entry destination at root for every platform", () => {
    assert.equal(INSTALL_PORTAL_CRM_ENTRY_URL, "/");
    assert.match(source, /href="\$\{crmUrl\}"/);
    assert.match(source, /var CRM_URL = /);
    for (const locale of Object.keys(INSTALL_PORTAL_COPY) as Array<
      keyof typeof INSTALL_PORTAL_COPY
    >) {
      const html = buildInstallPortalHtml(locale);
      assert.match(html, /href="\/"/);
    }
  });
});

describe("crm install portal security", () => {
  const routeSource = readFileSync(
    join(ROOT, "src/app/install/route.ts"),
    "utf8",
  );
  const portalSource = readFileSync(
    join(ROOT, "src/lib/pwa/install-portal.ts"),
    "utf8",
  );

  it("does not call CRM APIs, read cookies, or handle Access tokens", () => {
    assert.doesNotMatch(routeSource, /\/api\/auth/i);
    assert.doesNotMatch(routeSource, /cookies/i);
    assert.doesNotMatch(portalSource, /\/api\//);
    assert.doesNotMatch(portalSource, /CF_Authorization/i);
    assert.doesNotMatch(portalSource, /fetch\(/);
    assert.doesNotMatch(portalSource, /XMLHttpRequest/i);
    assert.doesNotMatch(portalSource, /navigator\.sendBeacon/i);
  });
});

describe("crm install portal approved icons", () => {
  it("ships installation assets that match approved CRM icon sources", () => {
    const pairs = [
      ["public/icons/apple-touch-icon.png", "public/install/apple-touch-icon.png"],
      ["public/icons/icon-192.png", "public/install/icon-192.png"],
      ["public/icons/icon-512.png", "public/install/icon-512.png"],
    ] as const;

    for (const [source, target] of pairs) {
      assert.equal(existsSync(join(ROOT, target)), true);
      assert.equal(
        sha256(join(ROOT, source)),
        sha256(join(ROOT, target)),
        `icon mismatch for ${target}`,
      );
    }

    assert.equal(existsSync(join(ROOT, "public/install/manifest.webmanifest")), true);
    assert.equal(INSTALL_PORTAL_MANIFEST_PATH, "/install/manifest.webmanifest");
  });
});
