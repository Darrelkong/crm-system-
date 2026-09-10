import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { join } from "node:path";
import { KNOWLEDGE_ROLES } from "@/lib/knowledge/constants";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("Knowledge members role management UI", () => {
  it("shows the home entry only for Knowledge Admin", () => {
    const home = read("src/components/knowledge/knowledge-home-client.tsx");
    assert.match(
      home,
      /role === "knowledge_admin"[\s\S]*\/knowledge\/members[\s\S]*knowledge\.members\.homeEntry/,
    );
    const membersLinkCount = home.match(/\/knowledge\/members/g)?.length ?? 0;
    assert.equal(membersLinkCount, 1);
  });

  it("requires Knowledge Admin server-side on the members page", () => {
    const page = read("src/app/(dashboard)/knowledge/members/page.tsx");
    assert.match(page, /getKnowledgeSessionStatus/);
    assert.match(page, /status\.access\.initialized/);
    assert.match(page, /status\.access\.unlocked/);
    assert.match(page, /status\.role !== "knowledge_admin"/);
    assert.match(page, /redirect\("\/knowledge"\)/);
    assert.match(page, /listKnowledgeUsers/);
    assert.match(page, /currentUserId={status\.user\.id}/);
  });

  it("loads members from GET /api/knowledge/roles and batch-updates via PATCH", () => {
    const client = read("src/components/knowledge/knowledge-members-client.tsx");
    assert.match(client, /fetch\("\/api\/knowledge\/roles"/);
    assert.match(client, /method: "PATCH"/);
    assert.match(client, /savePendingChanges/);
    assert.match(client, /pendingChanges/);
    assert.match(client, /member\.displayName/);
    assert.match(client, /member\.email/);
    assert.doesNotMatch(client, /customer|contact_id|followUp/i);
    assert.doesNotMatch(client, /saveRole\(/);
  });

  it("exposes all four Knowledge role options", () => {
    const client = read("src/components/knowledge/knowledge-members-client.tsx");
    assert.deepEqual(KNOWLEDGE_ROLES, [
      "viewer",
      "contributor",
      "reviewer",
      "knowledge_admin",
    ]);
    assert.match(client, /KNOWLEDGE_ROLES\.map/);
    assert.match(client, /knowledge\.members\.roles\.\$\{/);
    assert.match(client, /value={role}/);
  });

  it("surfaces last-admin protection errors without bypassing server checks", () => {
    const client = read("src/components/knowledge/knowledge-members-client.tsx");
    const roleService = read("src/lib/knowledge/role-service.ts");
    const constants = read("src/lib/knowledge/constants.ts");
    assert.match(client, /KNOWLEDGE_LAST_ADMIN/);
    assert.match(client, /knowledge\.members\.lastAdminError/);
    assert.match(client, /isLastAdminLocked/);
    assert.match(client, /lastAdminReadonly/);
    assert.match(roleService, /KNOWLEDGE_ERROR_CODES\.LAST_ADMIN/);
    assert.match(roleService, /countKnowledgeAdmins/);
    assert.match(constants, /LAST_ADMIN: "KNOWLEDGE_LAST_ADMIN"/);
  });

  it("marks the current user and disables last-admin self-demotion in UI", () => {
    const client = read("src/components/knowledge/knowledge-members-client.tsx");
    assert.match(client, /currentUserId/);
    assert.match(client, /knowledge\.members\.youBadge/);
    assert.match(client, /isLastAdminLocked/);
    assert.match(client, /disabled={saving \|\| lastAdminLocked}/);
  });

  it("uses batch save with pending-changes indication", () => {
    const client = read("src/components/knowledge/knowledge-members-client.tsx");
    assert.match(client, /hasPendingChanges/);
    assert.match(client, /knowledge\.members\.unsavedChanges/);
    assert.match(client, /knowledge\.members\.saveChanges/);
    assert.match(client, /sticky bottom-0/);
  });

  it("uses a mobile-safe compact layout without desktop table width", () => {
    const client = read("src/components/knowledge/knowledge-members-client.tsx");
    assert.match(client, /space-y-2/);
    assert.match(client, /min-w-0/);
    assert.match(client, /break-all/);
    assert.match(client, /w-full/);
    assert.match(client, /flex flex-col/);
    assert.doesNotMatch(client, /<table/);
    assert.doesNotMatch(client, /min-w-\[/);
    assert.doesNotMatch(client, /overflow-x-auto/);
  });
});
