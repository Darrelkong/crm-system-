import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  CRM_APPLE_STARTUP_IMAGE_1170,
  CRM_APPLE_STARTUP_IMAGE_1170_MEDIA,
  CRM_APPLE_STARTUP_IMAGE_1284,
  CRM_APPLE_STARTUP_IMAGE_1284_MEDIA,
  CRM_APPLE_STARTUP_IMAGE_1320,
  CRM_APPLE_STARTUP_IMAGE_1320_MEDIA,
  CRM_APPLE_STARTUP_IMAGES,
  CRM_APPLE_STARTUP_UNIVERSAL_IMAGE,
} from "./apple-startup-images";
import {
  buildBootSplashInitScript,
  CRM_BOOT_SPLASH_INIT_SCRIPT,
} from "./boot-splash-bootstrap";
import {
  CRM_BOOT_SPLASH_CRITICAL_CSS,
  shouldEnableBootSplash,
} from "./boot-splash";
import { isStandaloneDisplayMode } from "./standalone";
import { shouldActivateStartupPreview } from "./startup-timing";

function startupImageEntry(
  url: string,
  media?: string,
): { url: string; media?: string } | undefined {
  return CRM_APPLE_STARTUP_IMAGES?.find((entry) => {
    if (entry.url !== url) {
      return false;
    }
    if (media === undefined) {
      return entry.media === undefined;
    }
    return entry.media === media;
  });
}

describe("crm apple startup images", () => {
  it("includes a universal startup image without media restrictions", () => {
    const universal = startupImageEntry(CRM_APPLE_STARTUP_UNIVERSAL_IMAGE);
    assert.ok(universal);
    assert.equal("media" in universal ? universal.media : undefined, undefined);
    assert.equal(
      CRM_APPLE_STARTUP_UNIVERSAL_IMAGE,
      CRM_APPLE_STARTUP_IMAGE_1284,
    );
  });

  it("retains optimized startup images for 1170x2532 and 1284x2778", () => {
    const image1170 = startupImageEntry(
      CRM_APPLE_STARTUP_IMAGE_1170,
      CRM_APPLE_STARTUP_IMAGE_1170_MEDIA,
    );
    const image1284 = startupImageEntry(
      CRM_APPLE_STARTUP_IMAGE_1284,
      CRM_APPLE_STARTUP_IMAGE_1284_MEDIA,
    );
    assert.ok(image1170);
    assert.ok(image1284);
    assert.equal(image1170.media, CRM_APPLE_STARTUP_IMAGE_1170_MEDIA);
    assert.equal(image1284.media, CRM_APPLE_STARTUP_IMAGE_1284_MEDIA);
    assert.match(
      CRM_APPLE_STARTUP_IMAGE_1170_MEDIA,
      /device-width:\s*390px/,
    );
    assert.match(
      CRM_APPLE_STARTUP_IMAGE_1284_MEDIA,
      /device-width:\s*428px/,
    );
  });

  it("adds an optimized startup image for iPhone 17 Pro Max portrait", () => {
    const image1320 = startupImageEntry(
      CRM_APPLE_STARTUP_IMAGE_1320,
      CRM_APPLE_STARTUP_IMAGE_1320_MEDIA,
    );
    assert.ok(image1320);
    assert.equal(image1320.media, CRM_APPLE_STARTUP_IMAGE_1320_MEDIA);
    assert.match(
      CRM_APPLE_STARTUP_IMAGE_1320_MEDIA,
      /device-width:\s*440px/,
    );
    assert.match(
      CRM_APPLE_STARTUP_IMAGE_1320_MEDIA,
      /device-height:\s*956px/,
    );
    assert.match(
      CRM_APPLE_STARTUP_IMAGE_1320_MEDIA,
      /-webkit-device-pixel-ratio:\s*3/,
    );
    assert.match(CRM_APPLE_STARTUP_IMAGE_1320_MEDIA, /orientation:\s*portrait/);
    assert.doesNotMatch(CRM_APPLE_STARTUP_IMAGE_1320_MEDIA, /iPhone/i);
  });

  it("ships startup PNG assets on disk", () => {
    for (const path of [
      CRM_APPLE_STARTUP_IMAGE_1170,
      CRM_APPLE_STARTUP_IMAGE_1284,
      CRM_APPLE_STARTUP_IMAGE_1320,
    ]) {
      const filePath = join(process.cwd(), "public", path.replace(/^\//, ""));
      assert.equal(existsSync(filePath), true, `missing ${path}`);
      const bytes = readFileSync(filePath);
      assert.equal(bytes[0], 0x89);
      assert.equal(bytes[1], 0x50);
      assert.equal(bytes[2], 0x4e);
      assert.equal(bytes[3], 0x47);
    }
  });

  it("keeps approved PNG icon assets unchanged in this task", () => {
    const layout = readFileSync(
      join(process.cwd(), "src/app/layout.tsx"),
      "utf8",
    );
    assert.match(layout, /apple-touch-icon\.png/);
    assert.match(layout, /icon-192\.png/);
    assert.doesNotMatch(layout, /apple-touch-icon\.svg/);
    for (const icon of [
      "public/icons/apple-touch-icon.png",
      "public/icons/icon-192.png",
      "public/icons/icon-512.png",
    ]) {
      assert.equal(existsSync(join(process.cwd(), icon)), true);
    }
  });

  it("does not add service worker or offline cache dependencies", () => {
    const layout = readFileSync(
      join(process.cwd(), "src/app/layout.tsx"),
      "utf8",
    );
    assert.doesNotMatch(layout, /serviceWorker/i);
    assert.doesNotMatch(layout, /navigator\.serviceWorker/i);
    assert.doesNotMatch(layout, /workbox/i);
    assert.doesNotMatch(layout, /offline/i);
  });

  it("keeps standalone HTML splash enabled and normal browser splash disabled", () => {
    assert.match(CRM_BOOT_SPLASH_CRITICAL_CSS, /display:\s*none\s*!important/);
    assert.match(
      CRM_BOOT_SPLASH_CRITICAL_CSS,
      /@media \(display-mode: standalone\)/,
    );
    assert.equal(
      shouldEnableBootSplash({
        standalone: false,
        startupPreview: false,
        allowDevPreview: true,
      }),
      false,
    );
    assert.equal(
      shouldEnableBootSplash({
        standalone: isStandaloneDisplayMode({
          displayModeStandalone: true,
          navigatorStandalone: false,
        }),
        startupPreview: false,
        allowDevPreview: false,
      }),
      true,
    );
  });

  it("does not use standalone detection for auth", () => {
    const initScript = CRM_BOOT_SPLASH_INIT_SCRIPT;
    assert.doesNotMatch(initScript, /auth/i);
    assert.doesNotMatch(initScript, /session/i);
    assert.doesNotMatch(initScript, /permission/i);
  });

  it("keeps production startupPreview disabled", () => {
    const productionScript = buildBootSplashInitScript(false);
    assert.match(productionScript, /allowDevPreview=false/);
    assert.equal(shouldActivateStartupPreview(true, false), false);
  });
});

describe("crm apple startup generated head", () => {
  const builtHtmlPath = join(
    process.cwd(),
    ".next/server/app/_not-found.html",
  );

  it("renders apple-touch-startup-image links in built HTML", () => {
    if (!existsSync(builtHtmlPath)) {
      return;
    }

    const html = readFileSync(builtHtmlPath, "utf8");

    const startupLinks = [
      ...html.matchAll(
        /<link[^>]*rel="apple-touch-startup-image"[^>]*>/g,
      ),
    ].map((match) => match[0]);

    assert.ok(
      startupLinks.length >= 4,
      `expected at least 4 startup links, got ${startupLinks.length}`,
    );

    const universalLinks = startupLinks.filter(
      (link) =>
        link.includes(CRM_APPLE_STARTUP_UNIVERSAL_IMAGE) &&
        !link.includes("media="),
    );
    assert.equal(universalLinks.length, 1);

    for (const [url, media] of [
      [CRM_APPLE_STARTUP_IMAGE_1170, CRM_APPLE_STARTUP_IMAGE_1170_MEDIA],
      [CRM_APPLE_STARTUP_IMAGE_1284, CRM_APPLE_STARTUP_IMAGE_1284_MEDIA],
      [CRM_APPLE_STARTUP_IMAGE_1320, CRM_APPLE_STARTUP_IMAGE_1320_MEDIA],
    ] as const) {
      const matched = startupLinks.some(
        (link) => link.includes(url) && link.includes(`media="${media}"`),
      );
      assert.equal(matched, true, `missing startup link for ${url}`);
    }
  });
});
