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

  it("exposes required icon metadata", () => {
    const value = manifest();
    const icons = value.icons ?? [];
    assert.ok(icons.some((icon) => icon.sizes === "192x192"));
    assert.ok(icons.some((icon) => icon.sizes === "512x512"));
    assert.ok(icons.some((icon) => icon.sizes === "180x180"));
    assert.ok(icons.every((icon) => !String(icon.src).includes("session")));
    assert.ok(icons.every((icon) => !String(icon.src).includes("userId")));
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
  });

  it("ships apple touch icon asset", () => {
    const appleIcon = readFileSync(
      join(process.cwd(), "public/icons/apple-touch-icon.svg"),
      "utf8",
    );
    assert.match(appleIcon, /ECHFRONT CRM/);
    assert.match(appleIcon, /viewBox="0 0 180 180"/);
  });
});
