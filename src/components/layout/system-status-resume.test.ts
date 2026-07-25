import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_RESUME_GAP_MS,
  RESUME_DEBOUNCE_MS,
  RESUME_MAX_ATTEMPTS,
  RESUME_REFRESH_TIMEOUT_MS,
  classifyResumeSessionProbe,
  createResumeRequestGate,
  mayWriteSuccessfulStatusCache,
  planBackgroundHealthPoll,
  planHeartbeatTick,
  planMountProbe,
  resumeHealthUrl,
  resumeRetryDelayMs,
  shouldAcceptGeneration,
  shouldRetryResumeAttempt,
  waitForRefreshTransition,
} from "./system-status-resume";
import {
  clearStatusCacheForTest,
  getStatusCache,
  setStatusCache,
} from "./system-status-cache";

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

  describe("planBackgroundHealthPoll", () => {
    const base = {
      offlineAfterConsecutiveFailures: 2,
      resumeRunning: false,
    };

    it("online + health success → keep online", () => {
      assert.deepEqual(
        planBackgroundHealthPoll({
          ...base,
          currentStatus: "online",
          healthOk: true,
          healthStatus: "online",
          consecutiveFailuresAfterThis: 0,
        }),
        { action: "keep", status: "online" },
      );
    });

    it("online + health success with degraded → keep degraded", () => {
      assert.deepEqual(
        planBackgroundHealthPoll({
          ...base,
          currentStatus: "online",
          healthOk: true,
          healthStatus: "degraded",
          consecutiveFailuresAfterThis: 0,
        }),
        { action: "keep", status: "degraded" },
      );
    });

    it("online + first health failure → set_checking", () => {
      assert.deepEqual(
        planBackgroundHealthPoll({
          ...base,
          currentStatus: "online",
          healthOk: false,
          consecutiveFailuresAfterThis: 1,
        }),
        { action: "set_checking" },
      );
    });

    it("online + consecutive health failures → set_offline", () => {
      assert.deepEqual(
        planBackgroundHealthPoll({
          ...base,
          currentStatus: "online",
          healthOk: false,
          consecutiveFailuresAfterThis: 2,
        }),
        { action: "set_offline" },
      );
    });

    it("offline + health success → request_resume (never direct online)", () => {
      assert.deepEqual(
        planBackgroundHealthPoll({
          ...base,
          currentStatus: "offline",
          healthOk: true,
          healthStatus: "online",
          consecutiveFailuresAfterThis: 0,
        }),
        { action: "request_resume" },
      );
    });

    it("offline + health failure → stay offline", () => {
      assert.deepEqual(
        planBackgroundHealthPoll({
          ...base,
          currentStatus: "offline",
          healthOk: false,
          consecutiveFailuresAfterThis: 3,
        }),
        { action: "set_offline" },
      );
    });

    it("checking + health success while idle → request_resume not green", () => {
      assert.deepEqual(
        planBackgroundHealthPoll({
          ...base,
          currentStatus: "checking",
          healthOk: true,
          healthStatus: "online",
          consecutiveFailuresAfterThis: 0,
        }),
        { action: "request_resume" },
      );
    });

    it("checking + health success while resume running → skip", () => {
      assert.deepEqual(
        planBackgroundHealthPoll({
          ...base,
          currentStatus: "checking",
          healthOk: true,
          healthStatus: "online",
          resumeRunning: true,
          consecutiveFailuresAfterThis: 0,
        }),
        { action: "skip" },
      );
    });

    it("checking + health failure below threshold → skip (do not override)", () => {
      assert.deepEqual(
        planBackgroundHealthPoll({
          ...base,
          currentStatus: "checking",
          healthOk: false,
          consecutiveFailuresAfterThis: 1,
        }),
        { action: "skip" },
      );
    });

    it("checking + consecutive failures while idle → set_offline", () => {
      assert.deepEqual(
        planBackgroundHealthPoll({
          ...base,
          currentStatus: "checking",
          healthOk: false,
          consecutiveFailuresAfterThis: 2,
        }),
        { action: "set_offline" },
      );
    });

    it("any status while resume running → skip", () => {
      assert.deepEqual(
        planBackgroundHealthPoll({
          ...base,
          currentStatus: "offline",
          healthOk: true,
          healthStatus: "online",
          resumeRunning: true,
          consecutiveFailuresAfterThis: 0,
        }),
        { action: "skip" },
      );
      assert.deepEqual(
        planBackgroundHealthPoll({
          ...base,
          currentStatus: "online",
          healthOk: false,
          resumeRunning: true,
          consecutiveFailuresAfterThis: 2,
        }),
        { action: "skip" },
      );
    });

    it("resume failure path: offline then health success still cannot keep online", () => {
      const plan = planBackgroundHealthPoll({
        ...base,
        currentStatus: "offline",
        healthOk: true,
        healthStatus: "online",
        consecutiveFailuresAfterThis: 0,
      });
      assert.notEqual(plan.action, "keep");
      assert.equal(plan.action, "request_resume");
    });
  });

  describe("planHeartbeatTick", () => {
    it("short gap while visible does not request resume", () => {
      assert.deepEqual(
        planHeartbeatTick({
          nowMs: 10_000,
          lastHeartbeatAt: 10_000 - 3_000,
          visibilityState: "visible",
          resumeRunning: false,
        }),
        { action: "none", nextHeartbeatAt: 10_000 },
      );
      assert.ok(HEARTBEAT_INTERVAL_MS < HEARTBEAT_RESUME_GAP_MS);
    });

    it("long gap while visible requests resume", () => {
      assert.deepEqual(
        planHeartbeatTick({
          nowMs: 60_000,
          lastHeartbeatAt: 60_000 - HEARTBEAT_RESUME_GAP_MS,
          visibilityState: "visible",
          resumeRunning: false,
        }),
        { action: "request_resume", nextHeartbeatAt: 60_000 },
      );
    });

    it("long gap while hidden does not request resume", () => {
      assert.deepEqual(
        planHeartbeatTick({
          nowMs: 60_000,
          lastHeartbeatAt: 0,
          visibilityState: "hidden",
          resumeRunning: false,
        }),
        { action: "none", nextHeartbeatAt: 60_000 },
      );
    });

    it("does not request resume while resume is already running", () => {
      assert.deepEqual(
        planHeartbeatTick({
          nowMs: 60_000,
          lastHeartbeatAt: 0,
          visibilityState: "visible",
          resumeRunning: true,
        }),
        { action: "none", nextHeartbeatAt: 60_000 },
      );
    });
  });

  describe("planMountProbe", () => {
    it("fresh online cache → delay_health_poll (no immediate full resume)", () => {
      assert.deepEqual(
        planMountProbe({
          visibilityState: "visible",
          cached: "online",
          cacheRemainingMs: 40_000,
        }),
        { action: "delay_health_poll", delayMs: 40_000 },
      );
    });

    it("no cache and visible → request_resume", () => {
      assert.deepEqual(
        planMountProbe({
          visibilityState: "visible",
          cached: null,
          cacheRemainingMs: 0,
        }),
        { action: "request_resume" },
      );
    });

    it("expired cache remaining 0 and visible → request_resume", () => {
      assert.deepEqual(
        planMountProbe({
          visibilityState: "visible",
          cached: "online",
          cacheRemainingMs: 0,
        }),
        { action: "request_resume" },
      );
    });

    it("offline cache and visible → request_resume", () => {
      assert.deepEqual(
        planMountProbe({
          visibilityState: "visible",
          cached: "offline",
          cacheRemainingMs: 20_000,
        }),
        { action: "request_resume" },
      );
    });

    it("hidden without fresh cache → idle", () => {
      assert.deepEqual(
        planMountProbe({
          visibilityState: "hidden",
          cached: null,
          cacheRemainingMs: 0,
        }),
        { action: "idle" },
      );
    });
  });

  describe("mayWriteSuccessfulStatusCache", () => {
    it("allows online/degraded/offline and rejects checking", () => {
      assert.equal(mayWriteSuccessfulStatusCache("online"), true);
      assert.equal(mayWriteSuccessfulStatusCache("degraded"), true);
      assert.equal(mayWriteSuccessfulStatusCache("offline"), true);
      assert.equal(mayWriteSuccessfulStatusCache("checking"), false);
    });
  });

  describe("resume success cache rewrite", () => {
    it("writes online cache after success so remount can reuse it", () => {
      clearStatusCacheForTest();
      const now = Date.now();
      // Simulate full resume success writing cache (not mid-checking).
      assert.equal(mayWriteSuccessfulStatusCache("online"), true);
      setStatusCache("online", now);
      assert.equal(getStatusCache(now + 1_000), "online");
      assert.deepEqual(
        planMountProbe({
          visibilityState: "visible",
          cached: getStatusCache(now + 1_000),
          cacheRemainingMs: 49_000,
        }),
        { action: "delay_health_poll", delayMs: 49_000 },
      );
    });

    it("does not treat checking as a cacheable online success", () => {
      clearStatusCacheForTest();
      assert.equal(mayWriteSuccessfulStatusCache("checking"), false);
      assert.equal(getStatusCache(), null);
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

    it("coalesces heartbeat + visibility into a single resume run", async () => {
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

      const requestResume = () => {
        gate.request(async () => {
          runs += 1;
        });
      };

      // visibilitychange
      requestResume();
      // heartbeat long-gap in the same burst
      const tick = planHeartbeatTick({
        nowMs: 50_000,
        lastHeartbeatAt: 0,
        visibilityState: "visible",
        resumeRunning: gate.isRunning(),
      });
      if (tick.action === "request_resume") requestResume();

      assert.equal(timers.size, 1);
      [...timers.values()][0]();
      await Promise.resolve();
      assert.equal(runs, 1);
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
