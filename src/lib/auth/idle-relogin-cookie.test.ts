import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

describe("legacy idle-to-Access reauthentication removal", () => {
  it("keeps the former idle relogin implementation unreachable", () => {
    const sources = [
      "../../middleware.ts",
      "../../app/api/auth/login/route.ts",
      "../../app/api/auth/logout/route.ts",
      "../../app/(auth)/login/page.tsx",
    ].map((relativePath) =>
      readFileSync(new URL(relativePath, import.meta.url), "utf8"),
    );

    for (const source of sources) {
      assert.doesNotMatch(source, /idle-relogin-cookie|incrementIdleRelogin/);
      assert.doesNotMatch(source, /crm_idle_relogin_count|crm_access_iat_marker/);
    }
  });
});
