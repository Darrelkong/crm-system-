import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import manifest, {
  CRM_PWA_DISPLAY,
  CRM_PWA_MANIFEST_ID,
  CRM_PWA_NAME,
  CRM_PWA_SHORT_NAME,
  CRM_PWA_START_URL,
} from "./manifest";

describe("crm pwa manifest", () => {
  it("uses ECHFRONT CRM identity and standalone display", () => {
    const value = manifest();
    assert.equal(value.name, CRM_PWA_NAME);
    assert.equal(value.short_name, CRM_PWA_SHORT_NAME);
    assert.equal(value.name, "ECHFRONT CRM");
    assert.equal(value.short_name, "ECHFRONT");
    assert.equal(value.display, CRM_PWA_DISPLAY);
    assert.equal(value.display, "standalone");
  });

  it("uses stable public manifest id and root start url", () => {
    const value = manifest();
    assert.equal(value.id, CRM_PWA_MANIFEST_ID);
    assert.equal(value.id, "https://crm.echfronthk.com/");
    assert.equal(value.start_url, CRM_PWA_START_URL);
    assert.equal(value.start_url, "/");
  });

  it("exposes required PNG icon metadata", () => {
    const value = manifest();
    const icons = value.icons ?? [];
    const icon192 = icons.find((icon) => icon.sizes === "192x192");
    const icon512 = icons.find((icon) => icon.sizes === "512x512");
    const appleIcon = icons.find((icon) => icon.sizes === "180x180");
    assert.equal(icon192?.src, "/icons/icon-192.png");
    assert.equal(icon192?.type, "image/png");
    assert.equal(icon512?.src, "/icons/icon-512.png");
    assert.equal(icon512?.type, "image/png");
    assert.equal(appleIcon?.src, "/icons/apple-touch-icon.png");
    assert.equal(appleIcon?.type, "image/png");
    assert.ok(icons.every((icon) => !String(icon.src).includes("session")));
    assert.ok(icons.every((icon) => !String(icon.src).includes("userId")));
    assert.ok(icons.every((icon) => !String(icon.src).includes(".svg")));
  });

  it("does not include user/session scoped manifest fields", () => {
    const serialized = JSON.stringify(manifest());
    assert.equal(serialized.includes("userId"), false);
    assert.equal(serialized.includes("session"), false);
    assert.equal(serialized.includes("email"), false);
    assert.equal(serialized.includes("role"), false);
  });
});

describe("crm pwa apple metadata", () => {
  it("declares apple web app metadata in root layout", () => {
    const layoutSource = readFileSync(
      join(process.cwd(), "src/app/layout.tsx"),
      "utf8",
    );
    assert.match(layoutSource, /appleWebApp/);
    assert.match(layoutSource, /title:\s*"ECHFRONT"/);
    assert.match(layoutSource, /viewportFit:\s*"cover"/);
    assert.match(layoutSource, /startupImage/);
    assert.match(layoutSource, /CRM_APPLE_STARTUP_IMAGES/);
  });

  it("ships apple touch icon PNG asset", () => {
    const appleIcon = readFileSync(
      join(process.cwd(), "public/icons/apple-touch-icon.png"),
    );
    assert.ok(appleIcon.length > 0);
    assert.equal(appleIcon[0], 0x89);
    assert.equal(appleIcon[1], 0x50);
    assert.equal(appleIcon[2], 0x4e);
    assert.equal(appleIcon[3], 0x47);
  });

  it("points layout apple icon metadata to PNG", () => {
    const layoutSource = readFileSync(
      join(process.cwd(), "src/app/layout.tsx"),
      "utf8",
    );
    assert.match(layoutSource, /apple-touch-icon\.png/);
    assert.match(layoutSource, /type:\s*"image\/png"/);
    assert.doesNotMatch(layoutSource, /apple-touch-icon\.svg/);
  });
});
