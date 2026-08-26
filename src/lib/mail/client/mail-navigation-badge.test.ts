import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { MAIL_PROTOTYPE_UNREAD_BADGE } from "@/lib/mail/prototype/mock-data";
import { resolveMailNavigationUnreadBadgeCount } from "@/lib/mail/client/mail-navigation-badge";
import {
  resolveMailReadSourceFromEnv,
  usesProductionMailReadSource,
} from "@/lib/mail/client/mail-read-source";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../../..");

describe("mail navigation unread badge", () => {
  it("defaults unset read source to prototype badge", () => {
    assert.equal(resolveMailReadSourceFromEnv(undefined), "prototype");
    assert.equal(
      resolveMailNavigationUnreadBadgeCount("prototype"),
      MAIL_PROTOTYPE_UNREAD_BADGE,
    );
  });

  it("resolves production read source without prototype badge", () => {
    assert.equal(resolveMailReadSourceFromEnv("production"), "production");
    assert.equal(usesProductionMailReadSource("production"), true);
    assert.equal(resolveMailNavigationUnreadBadgeCount("production"), null);
  });

  it("keeps prototype navigation badge behavior", () => {
    assert.equal(
      resolveMailNavigationUnreadBadgeCount("prototype"),
      MAIL_PROTOTYPE_UNREAD_BADGE,
    );
    assert.equal(resolveMailNavigationUnreadBadgeCount("prototype"), 6);
  });

  it("hides production badge when canonical unread count is unavailable", () => {
    assert.equal(resolveMailNavigationUnreadBadgeCount("production"), null);
  });

  it("does not surface a fake zero badge for production empty inbox", () => {
    const productionBadge = resolveMailNavigationUnreadBadgeCount("production");
    assert.equal(productionBadge, null);
    assert.notEqual(productionBadge, MAIL_PROTOTYPE_UNREAD_BADGE);
  });

  it("wires desktop and mobile navigation through the source-aware helper", () => {
    const appNavigation = readFileSync(
      join(repoRoot, "src/components/layout/app-navigation.tsx"),
      "utf8",
    );
    const compactRail = readFileSync(
      join(repoRoot, "src/components/mail/prototype/mail-compact-nav-rail.tsx"),
      "utf8",
    );

    for (const source of [appNavigation, compactRail]) {
      assert.match(source, /resolveMailNavigationUnreadBadgeCount/);
      assert.match(source, /resolveMailReadSource/);
      assert.doesNotMatch(source, /MAIL_PROTOTYPE_UNREAD_BADGE/);
    }
  });
});

describe("mail production deploy configuration", () => {
  it("persists NEXT_PUBLIC_MAIL_READ_SOURCE=production in npm run deploy", () => {
    const packageJson = JSON.parse(
      readFileSync(join(repoRoot, "package.json"), "utf8"),
    ) as { scripts?: { deploy?: string } };

    assert.match(
      packageJson.scripts?.deploy ?? "",
      /NEXT_PUBLIC_MAIL_READ_SOURCE=production/,
    );
  });
});
