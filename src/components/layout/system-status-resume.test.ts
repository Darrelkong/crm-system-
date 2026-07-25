import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  RESUME_DEBOUNCE_MS,
  RESUME_MAX_ATTEMPTS,
  RESUME_REFRESH_TIMEOUT_MS,
  classifyResumeSessionProbe,
  createResumeRequestGate,
  resumeHealthUrl,
  resumeRetryDelayMs,
  shouldAcceptGeneration,
  shouldRetryResumeAttempt,
  waitForRefreshTransition,
} from "./system-status-resume";

describe("system-status-resume", () => {
  describe("shouldAcceptGeneration", () => {
    it("accepts matching generation", () => {
      assert.equal(shouldAcceptGeneration(3, 3), true);
    });

    it("rejects stale generation", () => {
      assert.equal(shouldAcceptGeneration(4, 3), false);
    });

    it("rejects future mismatched generation", () => {
      assert.equal(shouldAcceptGeneration(2, 5), false);
    });
  });

  describe("classifyResumeSessionProbe", () => {
    it("maps ok session to ok", () => {
      assert.deepEqual(
        classifyResumeSessionProbe({ meKind: "ok", fetchFailed: false }),
        { kind: "ok" },
      );
    });

    it("maps session_end without treating as transient", () => {
      assert.deepEqual(
        classifyResumeSessionProbe({
          meKind: "session_end",
          fetchFailed: false,
        }),
        { kind: "session_end" },
      );
    });

    it("maps ignore to transient for retry", () => {
      assert.deepEqual(
        classifyResumeSessionProbe({ meKind: "ignore", fetchFailed: false }),
        { kind: "transient" },
      );
    });

    it("maps fetch failure to transient even if meKind ok", () => {
      assert.deepEqual(
        classifyResumeSessionProbe({ meKind: "ok", fetchFailed: true }),
        { kind: "transient" },
      );
    });
  });

  describe("retry policy", () => {
    it("exposes three attempts", () => {
      assert.equal(RESUME_MAX_ATTEMPTS, 3);
    });

    it("allows retry after first and second failure only", () => {
      assert.equal(shouldRetryResumeAttempt(0), true);
      assert.equal(shouldRetryResumeAttempt(1), true);
      assert.equal(shouldRetryResumeAttempt(2), false);
    });

    it("uses increasing delays", () => {
      assert.equal(resumeRetryDelayMs(0), 0);
      assert.equal(resumeRetryDelayMs(1), 600);
      assert.equal(resumeRetryDelayMs(2), 1_500);
      assert.ok(resumeRetryDelayMs(1) < resumeRetryDelayMs(2));
    });
  });

  describe("createResumeRequestGate", () => {
    it("debounces multiple requests into one run", async () => {
      const timers = new Map<number, () => void>();
      let nextId = 1;
      let runs = 0;

      const gate = createResumeRequestGate({
        delayMs: RESUME_DEBOUNCE_MS,
        schedule: (fn) => {
          const id = nextId++;
          timers.set(id, fn);
          return id;
        },
        clear: (id) => {
          timers.delete(id);
        },
      });

      gate.request(async () => {
        runs += 1;
      });
      gate.request(async () => {
        runs += 1;
      });
      gate.request(async () => {
        runs += 1;
      });

      assert.equal(timers.size, 1);
      const only = [...timers.values()][0];
      only();
      await Promise.resolve();
      assert.equal(runs, 1);
    });

    it("ignores request while a run is in flight", async () => {
      let resolveRun!: () => void;
      const runPromise = new Promise<void>((resolve) => {
        resolveRun = resolve;
      });

      const timers = new Map<number, () => void>();
      let nextId = 1;
      let runs = 0;

      const gate = createResumeRequestGate({
        delayMs: 0,
        schedule: (fn) => {
          const id = nextId++;
          timers.set(id, fn);
          return id;
        },
        clear: (id) => {
          timers.delete(id);
        },
      });

      gate.request(async () => {
        runs += 1;
        await runPromise;
      });
      [...timers.values()][0]();
      await Promise.resolve();
      assert.equal(gate.isRunning(), true);
      const timersWhileRunning = timers.size;

      gate.request(async () => {
        runs += 1;
      });
      // Ignored while in flight — no additional debounce timer scheduled.
      assert.equal(timers.size, timersWhileRunning);
      assert.equal(runs, 1);

      resolveRun();
      await runPromise;
      await Promise.resolve();
      assert.equal(gate.isRunning(), false);
      assert.equal(runs, 1);
    });

    it("cancel clears pending debounce timer", () => {
      const timers = new Map<number, () => void>();
      let nextId = 1;

      const gate = createResumeRequestGate({
        delayMs: RESUME_DEBOUNCE_MS,
        schedule: (fn) => {
          const id = nextId++;
          timers.set(id, fn);
          return id;
        },
        clear: (id) => {
          timers.delete(id);
        },
      });

      gate.request(async () => {});
      assert.equal(timers.size, 1);
      gate.cancel();
      assert.equal(timers.size, 0);
    });
  });

  describe("resumeHealthUrl", () => {
    it("adds a cache-busting resume query with the given timestamp", () => {
      assert.equal(
        resumeHealthUrl(1_700_000_000_000),
        "/api/health?resume=1700000000000",
      );
    });
  });

  describe("waitForRefreshTransition", () => {
    it("waits until pending becomes true then false", async () => {
      let pending = false;
      let started = false;
      let clock = 0;
      const sleeps: number[] = [];

      const result = waitForRefreshTransition({
        startRefresh: () => {
          started = true;
          pending = true;
        },
        isPending: () => pending,
        timeoutMs: 1_000,
        pollMs: 10,
        pendingGraceMs: 100,
        now: () => clock,
        sleep: async (ms) => {
          sleeps.push(ms);
          clock += ms;
          // After a few polls, settle the transition.
          if (sleeps.length >= 2) pending = false;
        },
      });

      assert.equal(await result, "completed");
      assert.equal(started, true);
    });

    it("returns never_pending when isPending never flips true", async () => {
      let clock = 0;
      const result = await waitForRefreshTransition({
        startRefresh: () => {},
        isPending: () => false,
        timeoutMs: 5_000,
        pollMs: 10,
        pendingGraceMs: 30,
        now: () => clock,
        sleep: async (ms) => {
          clock += ms;
        },
      });
      assert.equal(result, "never_pending");
    });

    it("returns timeout when pending stays true past deadline", async () => {
      let clock = 0;
      const result = await waitForRefreshTransition({
        startRefresh: () => {},
        isPending: () => true,
        timeoutMs: 40,
        pollMs: 10,
        pendingGraceMs: 100,
        now: () => clock,
        sleep: async (ms) => {
          clock += ms;
        },
      });
      assert.equal(result, "timeout");
      assert.ok(RESUME_REFRESH_TIMEOUT_MS > 0);
    });

    it("returns aborted when signal is already aborted", async () => {
      const controller = new AbortController();
      controller.abort();
      const result = await waitForRefreshTransition({
        startRefresh: () => {
          throw new Error("should not start");
        },
        isPending: () => false,
        signal: controller.signal,
      });
      assert.equal(result, "aborted");
    });
  });
});
