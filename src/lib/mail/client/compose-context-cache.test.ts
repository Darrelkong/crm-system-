import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import type { ComposeContextOption } from "@/lib/mail/client/draft-management";
import {
  clearComposeContextCache,
  clearComposeContextCacheForActor,
  clearComposeContextCacheOnSessionEnd,
  getCachedComposeContext,
  invalidateComposeContextCache,
  prefetchComposeContext,
  setCachedComposeContext,
} from "@/lib/mail/client/compose-context-cache";

const USER_A = "11111111-1111-1111-1111-111111111101";
const USER_B = "22222222-2222-2222-2222-222222222202";

function optionForUser(
  userId: string,
  address: string,
): ComposeContextOption {
  return {
    senderIdentityId: `${userId}-identity`,
    mailboxId: `${userId}-mailbox`,
    address,
    displayName: address.split("@")[0] ?? address,
    mailboxAddress: address,
    mailboxDisplayName: null,
    mailboxType: "personal",
  };
}

describe("compose context cache", () => {
  it("returns null for unknown actor without serving another actor cache", () => {
    clearComposeContextCache();
    setCachedComposeContext(USER_A, [optionForUser(USER_A, "a@echfronthk.com")]);
    assert.equal(getCachedComposeContext(null), null);
    assert.equal(getCachedComposeContext(undefined), null);
    assert.equal(getCachedComposeContext(""), null);
    assert.equal(getCachedComposeContext(USER_B), null);
  });

  it("scopes cached options by actor user id", () => {
    clearComposeContextCache();
    const optionA = optionForUser(USER_A, "a@echfronthk.com");
    const optionB = optionForUser(USER_B, "b@echfronthk.com");
    setCachedComposeContext(USER_A, [optionA]);
    setCachedComposeContext(USER_B, [optionB]);

    assert.deepEqual(getCachedComposeContext(USER_A), [optionA]);
    assert.deepEqual(getCachedComposeContext(USER_B), [optionB]);
  });

  it("clears all actor entries on session end and invalidation", () => {
    clearComposeContextCache();
    setCachedComposeContext(USER_A, [optionForUser(USER_A, "a@echfronthk.com")]);
    setCachedComposeContext(USER_B, [optionForUser(USER_B, "b@echfronthk.com")]);

    clearComposeContextCacheOnSessionEnd();
    assert.equal(getCachedComposeContext(USER_A), null);
    assert.equal(getCachedComposeContext(USER_B), null);

    setCachedComposeContext(USER_A, [optionForUser(USER_A, "a@echfronthk.com")]);
    invalidateComposeContextCache();
    assert.equal(getCachedComposeContext(USER_A), null);
  });

  it("clears only one actor when requested", () => {
    clearComposeContextCache();
    setCachedComposeContext(USER_A, [optionForUser(USER_A, "a@echfronthk.com")]);
    setCachedComposeContext(USER_B, [optionForUser(USER_B, "b@echfronthk.com")]);

    clearComposeContextCacheForActor(USER_A);
    assert.equal(getCachedComposeContext(USER_A), null);
    assert.ok(getCachedComposeContext(USER_B));
  });

  it("prefetch serves cached options for the same actor only", async () => {
    clearComposeContextCache();
    setCachedComposeContext(USER_A, [optionForUser(USER_A, "a@echfronthk.com")]);
    const cached = await prefetchComposeContext(USER_A);
    assert.equal(cached?.[0]?.address, "a@echfronthk.com");
    assert.equal(getCachedComposeContext(USER_B), null);
  });

  it("blocks late User A response from populating User B after actor switch", async () => {
    clearComposeContextCache();
    const originalFetch = globalThis.fetch;
    let resolveFetch: ((value: Response) => void) | undefined;

    globalThis.fetch = (() =>
      new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      })) as typeof fetch;

    try {
      const pendingA = prefetchComposeContext(USER_A);
      clearComposeContextCacheForActor(USER_A);
      setCachedComposeContext(USER_B, [optionForUser(USER_B, "b@echfronthk.com")]);

      resolveFetch?.({
        ok: true,
        json: async () => ({
          items: [optionForUser(USER_A, "late-a@echfronthk.com")],
        }),
      } as Response);

      const lateResult = await pendingA;
      assert.equal(lateResult, null);
      assert.equal(getCachedComposeContext(USER_A), null);
      assert.equal(getCachedComposeContext(USER_B)?.[0]?.address, "b@echfronthk.com");
    } finally {
      globalThis.fetch = originalFetch;
      clearComposeContextCache();
    }
  });

  it("returns null prefetch for unknown actor", async () => {
    clearComposeContextCache();
    setCachedComposeContext(USER_A, [optionForUser(USER_A, "a@echfronthk.com")]);
    assert.equal(await prefetchComposeContext(null), null);
    assert.equal(await prefetchComposeContext(""), null);
  });
});

describe("compose context cache invalidation wiring", () => {
  it("invalidates after mailbox and sender identity admin mutations", () => {
    const mailboxManagement = readFileSync(
      "src/components/mail/admin/mailbox-management.tsx",
      "utf8",
    );
    const senderIdentityManagement = readFileSync(
      "src/components/mail/admin/sender-identity-management.tsx",
      "utf8",
    );
    const grantPanel = readFileSync(
      "src/components/mail/admin/sender-identity-grant-panel.tsx",
      "utf8",
    );
    const draftHook = readFileSync(
      "src/components/mail/compose/use-mail-compose-draft.tsx",
      "utf8",
    );
    const composeEditor = readFileSync(
      "src/components/mail/compose/mail-compose-editor.tsx",
      "utf8",
    );
    const shell = readFileSync(
      "src/components/mail/prototype/mail-prototype-shell.tsx",
      "utf8",
    );
    const clientSecurity = readFileSync("src/lib/auth/client-security.ts", "utf8");
    const sessionProvider = readFileSync(
      "src/lib/mail/client/mail-session-provider.tsx",
      "utf8",
    );
    const cacheSource = readFileSync(
      "src/lib/mail/client/compose-context-cache.ts",
      "utf8",
    );
    const fromSelector = readFileSync(
      "src/components/mail/compose/mail-compose-from-selector.tsx",
      "utf8",
    );

    assert.match(mailboxManagement, /invalidateComposeContextCache\(\)/);
    assert.match(senderIdentityManagement, /invalidateComposeContextCache\(\)/);
    assert.match(grantPanel, /invalidateComposeContextCache\(\)/);
    assert.match(draftHook, /getCachedComposeContext\(actorUserId\)/);
    assert.match(draftHook, /prefetchComposeContext\(bootstrapActorUserId\)/);
    assert.match(draftHook, /setCachedComposeContext\(bootstrapActorUserId/);
    assert.match(composeEditor, /actorUserId: session\?\.user\.id/);
    assert.match(shell, /prefetchComposeContext\(session\.user\.id\)/);
    assert.match(clientSecurity, /clearComposeContextCacheOnSessionEnd\(\)/);
    assert.match(sessionProvider, /clearComposeContextCacheOnSessionEnd\(\)/);
    assert.match(cacheSource, /cacheByActorUserId/);
    assert.doesNotMatch(fromSelector, /selectedMailboxId/);
  });
});
