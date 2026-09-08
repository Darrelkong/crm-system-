import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const routeSource = readFileSync(
  new URL("./route.ts", import.meta.url),
  "utf8",
);

describe("local CRM idle-expiry simulation route", () => {
  it("is a POST-only, flag-guarded local route", () => {
    assert.match(routeSource, /export async function POST/);
    assert.match(routeSource, /isLocalAuthSimulationEnabled/);
    assert.match(routeSource, /return new Response\("Not found", \{ status: 404 \}\)/);
    assert.doesNotMatch(routeSource, /getPostLogoutRedirectPath/);
  });

  it("uses a fixed CRM login redirect without a user-controlled target", () => {
    assert.match(routeSource, /status: 303/);
    assert.match(routeSource, /Location: "\/login\?reason=timeout"/);
    assert.doesNotMatch(routeSource, /Response\.redirect|new URL/);
    assert.doesNotMatch(routeSource, /searchParams|redirectTo/);
    assert.doesNotMatch(routeSource, /token.*query|query.*token/i);
  });

  it("uses a browser navigation so the timeout query survives the POST", () => {
    assert.match(routeSource, /export async function POST\(\)/);
    assert.match(routeSource, /destroySession/);
    assert.doesNotMatch(routeSource, /accessLogout|cdn-cgi\/access\/logout/);
  });
});
