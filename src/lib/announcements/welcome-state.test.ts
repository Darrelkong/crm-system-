import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

// Polyfill sessionStorage for Node.js test environment
function makeSessionStorage() {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, val: string) => store.set(key, val),
    removeItem: (key: string) => store.delete(key),
    clear: () => store.clear(),
    get length() {
      return store.size;
    },
    key: (n: number) => [...store.keys()][n] ?? null,
  };
}

describe("welcome-state", async () => {
  const mockSession = makeSessionStorage();

  // Inject window + sessionStorage mock before importing
  (globalThis as Record<string, unknown>).window = globalThis;
  (globalThis as Record<string, unknown>).sessionStorage = mockSession;

  const { hasSeenWelcomeThisSession, markWelcomeSeenThisSession, clearWelcomeSeenThisSession } =
    await import("./welcome-state");

  beforeEach(() => {
    mockSession.clear();
  });

  it("returns false when sessionStorage has no value", () => {
    assert.equal(hasSeenWelcomeThisSession(), false);
  });

  it("returns true after markWelcomeSeenThisSession", () => {
    markWelcomeSeenThisSession();
    assert.equal(hasSeenWelcomeThisSession(), true);
  });

  it("returns false after clearWelcomeSeenThisSession", () => {
    markWelcomeSeenThisSession();
    clearWelcomeSeenThisSession();
    assert.equal(hasSeenWelcomeThisSession(), false);
  });

  it("does not throw when window is undefined (SSR simulation)", () => {
    const saved = (globalThis as Record<string, unknown>).window;
    delete (globalThis as Record<string, unknown>).window;
    try {
      assert.doesNotThrow(() => hasSeenWelcomeThisSession());
      assert.doesNotThrow(() => markWelcomeSeenThisSession());
      assert.doesNotThrow(() => clearWelcomeSeenThisSession());
      assert.equal(hasSeenWelcomeThisSession(), false);
    } finally {
      (globalThis as Record<string, unknown>).window = saved;
    }
  });
});
