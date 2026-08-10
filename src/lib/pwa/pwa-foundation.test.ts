import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const ROOT = process.cwd();
const SOURCE_DIRS = ["src", "public"];

function walk(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      if (entry === "node_modules" || entry === ".next" || entry === ".open-next") {
        continue;
      }
      walk(fullPath, files);
      continue;
    }
    if (/\.(test|spec)\.(ts|tsx|js|mjs)$/.test(entry)) {
      continue;
    }
    if (/\.(ts|tsx|js|mjs|json)$/.test(entry)) {
      files.push(fullPath);
    }
  }
  return files;
}

describe("pwa foundation safety", () => {
  it("does not register a service worker", () => {
    const files = SOURCE_DIRS.flatMap((dir) => walk(join(ROOT, dir)));
    const offenders = files.filter((file) => {
      const source = readFileSync(file, "utf8");
      return (
        /navigator\.serviceWorker\.register/.test(source) ||
        /serviceWorker\.register\(/.test(source) ||
        /next-pwa/.test(source) ||
        /workbox/i.test(source)
      );
    });
    assert.deepEqual(offenders, []);
  });

  it("does not add service worker files", () => {
    const publicFiles = readdirSync(join(ROOT, "public"));
    assert.equal(publicFiles.includes("sw.js"), false);
    assert.equal(publicFiles.includes("service-worker.js"), false);
  });

  it("places install guidance in help center only", () => {
    const helpSource = readFileSync(
      join(ROOT, "src/app/(dashboard)/help/help-client.tsx"),
      "utf8",
    );
    assert.match(helpSource, /HomeScreenInstallGuide/);
    assert.doesNotMatch(helpSource, /modal/i);
  });

  it("keeps manifest identity and PNG icon paths unchanged", () => {
    const manifestSource = readFileSync(
      join(ROOT, "src/app/manifest.ts"),
      "utf8",
    );
    assert.match(manifestSource, /ECHFRONT CRM/);
    assert.match(manifestSource, /apple-touch-icon\.png/);
    assert.doesNotMatch(manifestSource, /\.svg/);
  });
});
