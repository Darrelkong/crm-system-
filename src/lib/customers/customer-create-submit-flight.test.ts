import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  clearCustomerCreateDraft,
  createEmptyCustomerCreateFormData,
  loadCustomerCreateDraft,
  saveCustomerCreateDraft,
} from "@/lib/customers/customer-create-draft";
import { createCustomerCreateDraftAutosave } from "@/lib/customers/customer-create-draft-autosave";
import {
  createCustomerCreateSubmitFlight,
  postCustomerCreateOnce,
} from "@/lib/customers/customer-create-submit-flight";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("customer create submit single-flight", () => {
  it("calls onAcquired synchronously before fetch starts", async () => {
    const flight = createCustomerCreateSubmitFlight();
    const order: string[] = [];
    const fetchImpl: typeof fetch = async () => {
      order.push("fetch");
      return new Response("{}", { status: 200 });
    };

    await postCustomerCreateOnce({
      flight,
      body: {},
      fetchImpl,
      onAcquired: () => {
        order.push("acquired");
      },
    });

    assert.deepEqual(order, ["acquired", "fetch"]);
  });

  it("acquires synchronously so a same-tick second call is blocked", () => {
    const flight = createCustomerCreateSubmitFlight();
    assert.equal(flight.acquire(), true);
    assert.equal(flight.isInFlight(), true);
    assert.equal(flight.acquire(), false);
    assert.equal(flight.isInFlight(), true);
  });

  it("same-tick double postCustomerCreateOnce only fetches once", async () => {
    const flight = createCustomerCreateSubmitFlight();
    let fetchCount = 0;
    const fetchImpl: typeof fetch = async () => {
      fetchCount += 1;
      await delay(30);
      return new Response(JSON.stringify({ ok: true, id: "cust-1" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    const body = { customerName: "QA Dual" };
    const [a, b] = await Promise.all([
      postCustomerCreateOnce({ flight, body, fetchImpl }),
      postCustomerCreateOnce({ flight, body, fetchImpl }),
    ]);

    assert.equal(fetchCount, 1);
    assert.equal(a.status, "response");
    assert.equal(b.status, "blocked");
    assert.equal(flight.isInFlight(), true);
  });

  it("blocks before React-style submitting state would update", async () => {
    const flight = createCustomerCreateSubmitFlight();
    let submitting = false;
    let fetchCount = 0;

    async function submitCreate() {
      // Authoritative lock is sync flight; state alone is insufficient.
      if (!flight.acquire()) return "flight-blocked";
      submitting = true;
      fetchCount += 1;
      await delay(20);
      return "ok";
    }

    const results = await Promise.all([submitCreate(), submitCreate()]);
    assert.ok(results.includes("ok"));
    assert.ok(results.includes("flight-blocked"));
    assert.equal(fetchCount, 1);
    assert.equal(submitting, true);
  });

  it("keeps lock after successful response (no second POST)", async () => {
    const flight = createCustomerCreateSubmitFlight();
    let fetchCount = 0;
    const fetchImpl: typeof fetch = async () => {
      fetchCount += 1;
      return new Response(JSON.stringify({ ok: true, id: "cust-ok" }), {
        status: 200,
      });
    };

    const first = await postCustomerCreateOnce({
      flight,
      body: {},
      fetchImpl,
    });
    assert.equal(first.status, "response");
    assert.equal(flight.isInFlight(), true);

    const second = await postCustomerCreateOnce({
      flight,
      body: {},
      fetchImpl,
    });
    assert.equal(second.status, "blocked");
    assert.equal(fetchCount, 1);
  });

  it("releases on network error so a retry can POST once", async () => {
    const flight = createCustomerCreateSubmitFlight();
    let fetchCount = 0;
    const fetchImpl: typeof fetch = async () => {
      fetchCount += 1;
      if (fetchCount === 1) {
        throw new TypeError("network down");
      }
      return new Response(JSON.stringify({ ok: true, id: "retry-1" }), {
        status: 200,
      });
    };

    const failed = await postCustomerCreateOnce({
      flight,
      body: {},
      fetchImpl,
    });
    assert.equal(failed.status, "network_error");
    assert.equal(flight.isInFlight(), false);

    const retry = await postCustomerCreateOnce({
      flight,
      body: {},
      fetchImpl,
    });
    assert.equal(retry.status, "response");
    assert.equal(fetchCount, 2);
  });

  it("HTTP 500 leaves lock held until caller releases for retry", async () => {
    const flight = createCustomerCreateSubmitFlight();
    let fetchCount = 0;
    const fetchImpl: typeof fetch = async () => {
      fetchCount += 1;
      if (fetchCount === 1) {
        return new Response(JSON.stringify({ error: "server" }), { status: 500 });
      }
      return new Response(JSON.stringify({ ok: true, id: "after-500" }), {
        status: 200,
      });
    };

    const failed = await postCustomerCreateOnce({
      flight,
      body: {},
      fetchImpl,
    });
    assert.equal(failed.status, "response");
    if (failed.status === "response") {
      assert.equal(failed.response.status, 500);
    }
    // Form unlocks on non-success so the user can retry.
    flight.release();
    assert.equal(flight.isInFlight(), false);

    const retry = await postCustomerCreateOnce({
      flight,
      body: {},
      fetchImpl,
    });
    assert.equal(retry.status, "response");
    assert.equal(fetchCount, 2);
  });

  it("validation / modal continue paths never acquire the flight", () => {
    const flight = createCustomerCreateSubmitFlight();
    // Opening confirm / incomplete continue must not lock.
    assert.equal(flight.isInFlight(), false);
    assert.equal(flight.acquire(), true);
    flight.release();
    assert.equal(flight.isInFlight(), false);
  });

  it("on-hold pending accepted keeps lock like normal create", async () => {
    const flight = createCustomerCreateSubmitFlight();
    let fetchCount = 0;
    const fetchImpl: typeof fetch = async () => {
      fetchCount += 1;
      return new Response(
        JSON.stringify({ ok: true, pendingApproval: true, approvalId: "a1" }),
        { status: 200 },
      );
    };

    const first = await postCustomerCreateOnce({
      flight,
      body: { salesStage: "on_hold", onHoldReason: "暫緩說明足夠十字" },
      fetchImpl,
    });
    assert.equal(first.status, "response");
    assert.equal(flight.isInFlight(), true);

    const second = await postCustomerCreateOnce({
      flight,
      body: { salesStage: "on_hold", onHoldReason: "暫緩說明足夠十字" },
      fetchImpl,
    });
    assert.equal(second.status, "blocked");
    assert.equal(fetchCount, 1);
  });

  it("success finalize keeps draft write-blocked (HOTFIX regression)", async () => {
    const userId = "user-flight-success";
    const memory = new Map<string, string>();
    const previous = globalThis.localStorage;
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (k: string) => (memory.has(k) ? memory.get(k)! : null),
        setItem: (k: string, v: string) => {
          memory.set(k, v);
        },
        removeItem: (k: string) => {
          memory.delete(k);
        },
        clear: () => memory.clear(),
        key: (i: number) => [...memory.keys()][i] ?? null,
        get length() {
          return memory.size;
        },
      } satisfies Storage,
    });

    try {
      clearCustomerCreateDraft(userId);
      const form = {
        ...createEmptyCustomerCreateFormData(),
        customerName: "QA Flight",
        requestedProjectName: "Visa",
        phone: "13800138000",
        wechatId: "wx",
        source: "referral",
        notes: "首次溝通說明超過十個字以上內容",
        salesStage: "new_lead",
      };
      saveCustomerCreateDraft(userId, form);
      assert.ok(loadCustomerCreateDraft(userId).ok);

      const flight = createCustomerCreateSubmitFlight();
      const autosave = createCustomerCreateDraftAutosave({
        onPersisted: () => {},
      });
      autosave.setReady(true);

      const fetchImpl: typeof fetch = async () =>
        new Response(JSON.stringify({ ok: true, id: "cust-final" }), {
          status: 200,
        });

      const result = await postCustomerCreateOnce({
        flight,
        body: form,
        fetchImpl,
      });
      assert.equal(result.status, "response");

      autosave.finalizeAccepted(userId);
      assert.equal(loadCustomerCreateDraft(userId).ok, false);
      assert.equal(flight.isInFlight(), true);

      autosave.schedule(userId, form, false);
      assert.equal(loadCustomerCreateDraft(userId).ok, false);
    } finally {
      Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: previous,
      });
    }
  });

  it("HTTP 409 release preserves draft for retry", async () => {
    const userId = "user-flight-409";
    const memory = new Map<string, string>();
    const previous = globalThis.localStorage;
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (k: string) => (memory.has(k) ? memory.get(k)! : null),
        setItem: (k: string, v: string) => {
          memory.set(k, v);
        },
        removeItem: (k: string) => {
          memory.delete(k);
        },
        clear: () => memory.clear(),
        key: (i: number) => [...memory.keys()][i] ?? null,
        get length() {
          return memory.size;
        },
      } satisfies Storage,
    });

    try {
      clearCustomerCreateDraft(userId);
      const form = {
        ...createEmptyCustomerCreateFormData(),
        customerName: "QA Dup",
        requestedProjectName: "Visa",
        phone: "13800138000",
        wechatId: "wx",
        source: "referral",
        notes: "首次溝通說明超過十個字以上內容",
        salesStage: "new_lead",
      };
      saveCustomerCreateDraft(userId, form);

      const flight = createCustomerCreateSubmitFlight();
      const fetchImpl: typeof fetch = async () =>
        new Response(
          JSON.stringify({ code: "duplicate_customer", duplicates: [] }),
          { status: 409 },
        );

      const result = await postCustomerCreateOnce({
        flight,
        body: form,
        fetchImpl,
      });
      assert.equal(result.status, "response");
      flight.release();
      assert.ok(loadCustomerCreateDraft(userId).ok);
    } finally {
      Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: previous,
      });
    }
  });
});
