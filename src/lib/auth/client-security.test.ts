import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";
import {
  ACCESS_REVERIFY_LOGIN_PATH,
  clearCustomerCreateDraftOnExplicitLogout,
  clearSessionClientState,
  getAccessReverifyRedirectPath,
  parseBroadcastLogoutReason,
  parseSessionEndReason,
  performSecurityLogout,
  sessionEndMessageKey,
  sessionEndShowsModal,
  shouldInspectSessionApiResponse,
} from "@/lib/auth/client-security";
import { CLOUDFLARE_ACCESS_LOGOUT_PATH } from "@/lib/auth/logout-redirect";
import {
  createEmptyCustomerCreateFormData,
  loadCustomerCreateDraft,
  saveCustomerCreateDraft,
} from "@/lib/customers/customer-create-draft";

describe("parseSessionEndReason", () => {
  it("maps SESSION_ACCESS_REVERIFY_REQUIRED to access_reverify", () => {
    assert.equal(
      parseSessionEndReason("SESSION_ACCESS_REVERIFY_REQUIRED"),
      "access_reverify",
    );
  });

  it("keeps existing error code mappings", () => {
    assert.equal(parseSessionEndReason("SESSION_IDLE_EXPIRED"), "idle");
    assert.equal(parseSessionEndReason("SESSION_REVOKED"), "revoked");
    assert.equal(parseSessionEndReason("SESSION_INVALID"), "invalid");
    assert.equal(
      parseSessionEndReason("SESSION_DEVICE_REVOKED"),
      "device_revoked",
    );
  });

  it("does not map unrelated codes", () => {
    assert.equal(parseSessionEndReason("ACCOUNT_LOCKED"), null);
    assert.equal(parseSessionEndReason(undefined), null);
  });
});

describe("access reverify redirect paths", () => {
  it("uses Access logout path in production (non-local)", () => {
    assert.equal(
      getAccessReverifyRedirectPath(false),
      CLOUDFLARE_ACCESS_LOGOUT_PATH,
    );
    assert.ok(!getAccessReverifyRedirectPath(false).includes("reason=timeout"));
    assert.ok(
      !getAccessReverifyRedirectPath(false).includes("session_end=revoked"),
    );
  });

  it("uses dedicated login query in local development", () => {
    assert.equal(getAccessReverifyRedirectPath(true), ACCESS_REVERIFY_LOGIN_PATH);
    assert.equal(
      ACCESS_REVERIFY_LOGIN_PATH,
      "/login?session_end=access_reverify",
    );
    assert.ok(!ACCESS_REVERIFY_LOGIN_PATH.includes("reason=timeout"));
  });
});

describe("session end modal / message keys", () => {
  it("access_reverify does not show modal", () => {
    assert.equal(sessionEndShowsModal("access_reverify"), false);
    assert.equal(sessionEndShowsModal("idle"), true);
    assert.equal(sessionEndShowsModal("revoked"), true);
  });

  it("uses dedicated message key for access_reverify", () => {
    assert.equal(
      sessionEndMessageKey("access_reverify"),
      "security.accessReverifyRequired",
    );
    assert.equal(
      sessionEndMessageKey("idle"),
      "security.sessionTimedOutReLogin",
    );
    assert.equal(
      sessionEndMessageKey("revoked"),
      "security.sessionRevokedByOtherDevice",
    );
  });
});

describe("parseBroadcastLogoutReason", () => {
  it("preserves access_reverify and does not fold to idle", () => {
    assert.equal(parseBroadcastLogoutReason("access_reverify"), "access_reverify");
    assert.notEqual(parseBroadcastLogoutReason("access_reverify"), "idle");
  });

  it("preserves device_revoked and other reasons", () => {
    assert.equal(parseBroadcastLogoutReason("device_revoked"), "device_revoked");
    assert.equal(parseBroadcastLogoutReason("revoked"), "revoked");
    assert.equal(parseBroadcastLogoutReason("invalid"), "invalid");
    assert.equal(parseBroadcastLogoutReason("idle"), "idle");
  });

  it("ignores manual (no re-broadcast loop target)", () => {
    assert.equal(parseBroadcastLogoutReason("manual"), null);
  });
});

describe("shouldInspectSessionApiResponse", () => {
  it("inspects protected API 401s", () => {
    assert.equal(shouldInspectSessionApiResponse("/api/customers"), true);
    assert.equal(shouldInspectSessionApiResponse("/api/auth/me"), true);
  });

  it("excludes login and logout to avoid recursion", () => {
    assert.equal(shouldInspectSessionApiResponse("/api/auth/login"), false);
    assert.equal(shouldInspectSessionApiResponse("/api/auth/logout"), false);
  });

  it("ignores non-api URLs", () => {
    assert.equal(shouldInspectSessionApiResponse("/staff"), false);
  });
});

describe("customer create draft vs session clear", () => {
  class MemoryStorage implements Storage {
    private store = new Map<string, string>();
    get length(): number {
      return this.store.size;
    }
    clear(): void {
      this.store.clear();
    }
    getItem(key: string): string | null {
      return this.store.has(key) ? this.store.get(key)! : null;
    }
    key(index: number): string | null {
      return [...this.store.keys()][index] ?? null;
    }
    removeItem(key: string): void {
      this.store.delete(key);
    }
    setItem(key: string, value: string): void {
      this.store.set(key, value);
    }
  }

  let previous: Storage | undefined;

  afterEach(() => {
    mock.restoreAll();
    if (previous !== undefined) {
      Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: previous,
      });
    }
  });

  function installLocalStorage() {
    previous = globalThis.localStorage;
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: new MemoryStorage(),
    });
  }

  function seedDraft(userId: string) {
    saveCustomerCreateDraft(userId, {
      ...createEmptyCustomerCreateFormData(),
      customerName: `Draft ${userId}`,
      phone: "13800138000",
      notes: "足夠長度的首次溝通備註內容",
      source: "referral",
    });
  }

  it("clearSessionClientState does not remove customer-create drafts", async () => {
    installLocalStorage();
    mock.method(globalThis, "fetch", async () => new Response("{}", { status: 200 }));
    seedDraft("user-a");
    localStorage.setItem("crm_locale", "zh-Hant");
    localStorage.setItem("crm-login-theme", "dark");

    await clearSessionClientState("expired");

    assert.equal(loadCustomerCreateDraft("user-a").ok, true);
    assert.equal(localStorage.getItem("crm_locale"), "zh-Hant");
    assert.equal(localStorage.getItem("crm-login-theme"), "dark");
  });

  it("Access-reverify style clear keeps drafts (same as clearSessionClientState)", async () => {
    installLocalStorage();
    mock.method(globalThis, "fetch", async () => new Response("{}", { status: 200 }));
    seedDraft("user-a");
    await clearSessionClientState("expired");
    assert.equal(loadCustomerCreateDraft("user-a").ok, true);
  });

  it("explicit logout clears only last saver draft, not other users or theme/locale", async () => {
    installLocalStorage();
    seedDraft("user-a");
    seedDraft("user-b");
    localStorage.setItem("crm_locale", "zh-Hant");
    localStorage.setItem("crm-login-theme", "light");

    await clearCustomerCreateDraftOnExplicitLogout();

    assert.equal(loadCustomerCreateDraft("user-b").ok, false);
    assert.equal(loadCustomerCreateDraft("user-a").ok, true);
    assert.equal(localStorage.getItem("crm_locale"), "zh-Hant");
    assert.equal(localStorage.getItem("crm-login-theme"), "light");
  });

  it("performSecurityLogout(manual) clears last draft; idle reason does not", async () => {
    installLocalStorage();
    mock.method(globalThis, "fetch", async () => new Response("{}", { status: 200 }));
    const loc = { href: "http://localhost:3000/customers/new" };
    const previousWindow = (globalThis as { window?: unknown }).window;
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { location: loc },
    });

    try {
      seedDraft("user-a");
      await performSecurityLogout("idle");
      assert.equal(loadCustomerCreateDraft("user-a").ok, true);

      await performSecurityLogout("manual");
      assert.equal(loadCustomerCreateDraft("user-a").ok, false);
    } finally {
      if (previousWindow === undefined) {
        Reflect.deleteProperty(globalThis, "window");
      } else {
        Object.defineProperty(globalThis, "window", {
          configurable: true,
          value: previousWindow,
        });
      }
    }
  });
});
