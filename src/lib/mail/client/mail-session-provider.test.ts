import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function read(path: string): string {
  return readFileSync(path, "utf8");
}

describe("MailSessionProvider access revalidation wiring", () => {
  it("revalidates on focus, visible state, and a modest interval", () => {
    const source = read("src/lib/mail/client/mail-session-provider.tsx");
    assert.match(source, /addEventListener\("focus"/);
    assert.match(source, /addEventListener\("visibilitychange"/);
    assert.match(source, /setInterval\(refreshIfVisible, 60_000\)/);
    assert.match(source, /MAIL_ACCESS_DISABLED_EVENT/);
  });

  it("fails closed and clears compose state when access is unavailable", () => {
    const source = read("src/lib/mail/client/mail-session-provider.tsx");
    assert.match(source, /setSession\(null\)/);
    assert.match(source, /clearComposeContextCacheForActor/);
    assert.match(source, /!session\.mailAccessEnabled/);
  });

  it("clears the production workspace when access is disabled", () => {
    const boundary = read(
      "src/lib/mail/client/mail-workspace-data-source-boundary.tsx",
    );
    const workspace = read("src/lib/mail/client/mail-workspace-context.tsx");
    assert.match(boundary, /workspace\.clearSensitiveState\(\)/);
    assert.match(workspace, /MAIL_ACCESS_DISABLED_EVENT/);
    assert.match(workspace, /state = \{ \.\.\.INITIAL_MAIL_WORKSPACE_STATE \}/);
  });
});
