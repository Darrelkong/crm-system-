import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  createFollowUpSubmitFlight,
  postFollowUpCreateOnce,
} from "@/lib/follow-ups/follow-up-create-submit-flight";
import {
  MIN_NEXT_FOLLOW_UP_LEAD_MINUTES,
  validateFollowUpInput,
} from "@/lib/follow-ups/validation";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const formSource = readFileSync(
  join(
    process.cwd(),
    "src/app/(dashboard)/customers/[id]/follow-ups/new/new-follow-up-form.tsx",
  ),
  "utf8",
);

const fixedNow = new Date("2026-06-24T10:00:00.000Z");

function validBody() {
  const next = new Date(
    fixedNow.getTime() + MIN_NEXT_FOLLOW_UP_LEAD_MINUTES * 60 * 1000,
  ).toISOString();
  return {
    channel: "phone",
    outcome: "contact_made",
    summary: "这是一段足够长的跟进摘要内容",
    customerIntent: "客户希望了解产品报价方案",
    nextFollowUpAt: next,
    nextAction: "安排下周再次电话沟通确认需求细节",
  };
}

/**
 * Mirrors NewFollowUpForm submit gate: validate → acquire → onAcquired → fetch.
 * Used to prove same-tick multi-submit behaviour without a React renderer.
 */
async function submitFollowUpLikeForm(options: {
  flight: ReturnType<typeof createFollowUpSubmitFlight>;
  body: Record<string, unknown>;
  customerId?: string;
  fetchImpl: typeof fetch;
  onRouterPush?: () => void;
  submittingRef: { current: boolean };
}) {
  const validationErrors = validateFollowUpInput(
    {
      channel: String(options.body.channel ?? ""),
      outcome: String(options.body.outcome ?? ""),
      summary: String(options.body.summary ?? ""),
      customerIntent: String(options.body.customerIntent ?? ""),
      nextFollowUpAt: (options.body.nextFollowUpAt as string) || null,
      nextAction: (options.body.nextAction as string) || null,
    },
    { now: fixedNow },
  );
  if (validationErrors.length > 0) {
    return { status: "validation" as const, errors: validationErrors };
  }

  const gated = await postFollowUpCreateOnce({
    flight: options.flight,
    customerId: options.customerId ?? "cust-1",
    body: options.body,
    fetchImpl: options.fetchImpl,
    onAcquired: () => {
      options.submittingRef.current = true;
    },
  });

  if (gated.status === "blocked") {
    return { status: "blocked" as const };
  }
  if (gated.status === "network_error") {
    options.flight.release();
    options.submittingRef.current = false;
    return { status: "network_error" as const };
  }

  if (gated.response.ok) {
    options.onRouterPush?.();
    return { status: "success" as const };
  }

  options.flight.release();
  options.submittingRef.current = false;
  return { status: "http_error" as const, httpStatus: gated.response.status };
}

describe("follow-up create submit single-flight", () => {
  it("calls onAcquired synchronously before fetch starts", async () => {
    const flight = createFollowUpSubmitFlight();
    const order: string[] = [];
    const fetchImpl: typeof fetch = async () => {
      order.push("fetch");
      return new Response("{}", { status: 200 });
    };

    await postFollowUpCreateOnce({
      flight,
      customerId: "c1",
      body: {},
      fetchImpl,
      onAcquired: () => {
        order.push("acquired");
      },
    });

    assert.deepEqual(order, ["acquired", "fetch"]);
  });

  it("acquires synchronously so a same-tick second call is blocked", () => {
    const flight = createFollowUpSubmitFlight();
    assert.equal(flight.acquire(), true);
    assert.equal(flight.isLocked(), true);
    assert.equal(flight.acquire(), false);
    assert.equal(flight.isLocked(), true);
  });

  it("same-tick double postFollowUpCreateOnce only fetches once", async () => {
    const flight = createFollowUpSubmitFlight();
    let fetchCount = 0;
    const fetchImpl: typeof fetch = async () => {
      fetchCount += 1;
      await delay(30);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };

    const body = validBody();
    const [a, b] = await Promise.all([
      postFollowUpCreateOnce({ flight, customerId: "c1", body, fetchImpl }),
      postFollowUpCreateOnce({ flight, customerId: "c1", body, fetchImpl }),
    ]);

    assert.equal(fetchCount, 1);
    assert.equal(a.status, "response");
    assert.equal(b.status, "blocked");
    assert.equal(flight.isLocked(), true);
  });

  it("same-tick four submits only fetch once", async () => {
    const flight = createFollowUpSubmitFlight();
    let fetchCount = 0;
    const fetchImpl: typeof fetch = async () => {
      fetchCount += 1;
      await delay(40);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };

    const body = validBody();
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        postFollowUpCreateOnce({ flight, customerId: "c1", body, fetchImpl }),
      ),
    );

    assert.equal(fetchCount, 1);
    assert.equal(results.filter((r) => r.status === "response").length, 1);
    assert.equal(results.filter((r) => r.status === "blocked").length, 3);
  });

  it("blocks before React-style submitting state would update", async () => {
    const flight = createFollowUpSubmitFlight();
    let submitting = false;
    let fetchCount = 0;

    async function submitOnce() {
      if (!flight.acquire()) return "flight-blocked";
      submitting = true;
      fetchCount += 1;
      await delay(20);
      return "ok";
    }

    const results = await Promise.all([submitOnce(), submitOnce()]);
    assert.ok(results.includes("ok"));
    assert.ok(results.includes("flight-blocked"));
    assert.equal(fetchCount, 1);
    assert.equal(submitting, true);
  });

  it("slow pending fetch blocks additional submits", async () => {
    const flight = createFollowUpSubmitFlight();
    let fetchCount = 0;
    let resolveFetch!: (value: Response) => void;
    const fetchImpl: typeof fetch = () => {
      fetchCount += 1;
      return new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      });
    };

    const first = postFollowUpCreateOnce({
      flight,
      customerId: "c1",
      body: validBody(),
      fetchImpl,
    });
    await delay(5);
    const second = await postFollowUpCreateOnce({
      flight,
      customerId: "c1",
      body: validBody(),
      fetchImpl,
    });
    assert.equal(second.status, "blocked");
    assert.equal(fetchCount, 1);

    resolveFetch(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const firstResult = await first;
    assert.equal(firstResult.status, "response");
    assert.equal(fetchCount, 1);
  });

  it("Enter+click style dual form submit still posts once", async () => {
    const flight = createFollowUpSubmitFlight();
    const submittingRef = { current: false };
    let fetchCount = 0;
    let routerPushCount = 0;
    const fetchImpl: typeof fetch = async () => {
      fetchCount += 1;
      await delay(25);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };

    const body = validBody();
    // Simulate Enter key submit + mouse click submit in the same tick.
    const [enter, click] = await Promise.all([
      submitFollowUpLikeForm({
        flight,
        body,
        fetchImpl,
        submittingRef,
        onRouterPush: () => {
          routerPushCount += 1;
        },
      }),
      submitFollowUpLikeForm({
        flight,
        body,
        fetchImpl,
        submittingRef,
        onRouterPush: () => {
          routerPushCount += 1;
        },
      }),
    ]);

    assert.equal(fetchCount, 1);
    assert.equal(routerPushCount, 1);
    assert.ok(
      [enter.status, click.status].includes("success") &&
        [enter.status, click.status].includes("blocked"),
    );
  });

  it("keeps lock after successful response (no second POST)", async () => {
    const flight = createFollowUpSubmitFlight();
    let fetchCount = 0;
    const fetchImpl: typeof fetch = async () => {
      fetchCount += 1;
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };

    const first = await postFollowUpCreateOnce({
      flight,
      customerId: "c1",
      body: validBody(),
      fetchImpl,
    });
    assert.equal(first.status, "response");
    assert.equal(flight.isLocked(), true);

    const second = await postFollowUpCreateOnce({
      flight,
      customerId: "c1",
      body: validBody(),
      fetchImpl,
    });
    assert.equal(second.status, "blocked");
    assert.equal(fetchCount, 1);
  });

  it("success path keeps lock so form-style retry does not fetch again", async () => {
    const flight = createFollowUpSubmitFlight();
    const submittingRef = { current: false };
    let fetchCount = 0;
    let routerPushCount = 0;
    const fetchImpl: typeof fetch = async () => {
      fetchCount += 1;
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };

    const first = await submitFollowUpLikeForm({
      flight,
      body: validBody(),
      fetchImpl,
      submittingRef,
      onRouterPush: () => {
        routerPushCount += 1;
      },
    });
    assert.equal(first.status, "success");
    assert.equal(flight.isLocked(), true);
    assert.equal(submittingRef.current, true);

    const second = await submitFollowUpLikeForm({
      flight,
      body: validBody(),
      fetchImpl,
      submittingRef,
      onRouterPush: () => {
        routerPushCount += 1;
      },
    });
    assert.equal(second.status, "blocked");
    assert.equal(fetchCount, 1);
    assert.equal(routerPushCount, 1);
  });

  it("releases on network error so a retry can POST once", async () => {
    const flight = createFollowUpSubmitFlight();
    let fetchCount = 0;
    const failing: typeof fetch = async () => {
      fetchCount += 1;
      throw new TypeError("network down");
    };

    const first = await postFollowUpCreateOnce({
      flight,
      customerId: "c1",
      body: validBody(),
      fetchImpl: failing,
    });
    assert.equal(first.status, "network_error");
    assert.equal(flight.isLocked(), false);

    const ok: typeof fetch = async () => {
      fetchCount += 1;
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };
    const second = await postFollowUpCreateOnce({
      flight,
      customerId: "c1",
      body: validBody(),
      fetchImpl: ok,
    });
    assert.equal(second.status, "response");
    assert.equal(fetchCount, 2);
  });

  it("HTTP 500 leaves lock held until caller releases for retry", async () => {
    const flight = createFollowUpSubmitFlight();
    let fetchCount = 0;
    const fetchImpl: typeof fetch = async () => {
      fetchCount += 1;
      return new Response(JSON.stringify({ error: "boom" }), { status: 500 });
    };

    const first = await postFollowUpCreateOnce({
      flight,
      customerId: "c1",
      body: validBody(),
      fetchImpl,
    });
    assert.equal(first.status, "response");
    assert.equal(flight.isLocked(), true);

    // Caller unlocks (form unlockSubmitFlight).
    flight.release();
    const second = await postFollowUpCreateOnce({
      flight,
      customerId: "c1",
      body: validBody(),
      fetchImpl,
    });
    assert.equal(second.status, "response");
    assert.equal(fetchCount, 2);
  });

  it("form-style HTTP 500 unlock allows one retry; double-click retry still once", async () => {
    const flight = createFollowUpSubmitFlight();
    const submittingRef = { current: false };
    let fetchCount = 0;
    const body = validBody();
    const fetchImpl: typeof fetch = async () => {
      fetchCount += 1;
      if (fetchCount === 1) {
        return new Response(JSON.stringify({ error: "boom" }), { status: 500 });
      }
      await delay(30);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };

    const fail = await submitFollowUpLikeForm({
      flight,
      body,
      fetchImpl,
      submittingRef,
    });
    assert.equal(fail.status, "http_error");
    assert.equal(flight.isLocked(), false);
    assert.equal(submittingRef.current, false);

    const [a, b] = await Promise.all([
      submitFollowUpLikeForm({ flight, body, fetchImpl, submittingRef }),
      submitFollowUpLikeForm({ flight, body, fetchImpl, submittingRef }),
    ]);
    assert.equal(fetchCount, 2);
    assert.ok(
      [a.status, b.status].includes("success") &&
        [a.status, b.status].includes("blocked"),
    );
  });

  it("validation failure does not acquire flight or POST", async () => {
    const flight = createFollowUpSubmitFlight();
    const submittingRef = { current: false };
    let fetchCount = 0;
    const fetchImpl: typeof fetch = async () => {
      fetchCount += 1;
      return new Response("{}", { status: 200 });
    };

    const result = await submitFollowUpLikeForm({
      flight,
      body: { ...validBody(), summary: "短" },
      fetchImpl,
      submittingRef,
    });
    assert.equal(result.status, "validation");
    assert.equal(flight.isLocked(), false);
    assert.equal(submittingRef.current, false);
    assert.equal(fetchCount, 0);
  });

  it("missing nextFollowUpAt does not POST", async () => {
    const flight = createFollowUpSubmitFlight();
    const submittingRef = { current: false };
    let fetchCount = 0;
    const fetchImpl: typeof fetch = async () => {
      fetchCount += 1;
      return new Response("{}", { status: 200 });
    };

    const result = await submitFollowUpLikeForm({
      flight,
      body: { ...validBody(), nextFollowUpAt: "" },
      fetchImpl,
      submittingRef,
    });
    assert.equal(result.status, "validation");
    assert.equal(fetchCount, 0);
    assert.equal(flight.isLocked(), false);
  });

  it("after validation fix, submit can POST once", async () => {
    const flight = createFollowUpSubmitFlight();
    const submittingRef = { current: false };
    let fetchCount = 0;
    const fetchImpl: typeof fetch = async () => {
      fetchCount += 1;
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };

    const bad = await submitFollowUpLikeForm({
      flight,
      body: { ...validBody(), summary: "短" },
      fetchImpl,
      submittingRef,
    });
    assert.equal(bad.status, "validation");

    const ok = await submitFollowUpLikeForm({
      flight,
      body: validBody(),
      fetchImpl,
      submittingRef,
    });
    assert.equal(ok.status, "success");
    assert.equal(fetchCount, 1);
  });

  it("each createFollowUpSubmitFlight instance is independent (not module-global)", () => {
    const a = createFollowUpSubmitFlight();
    const b = createFollowUpSubmitFlight();
    assert.equal(a.acquire(), true);
    assert.equal(b.acquire(), true);
    assert.equal(a.isLocked(), true);
    assert.equal(b.isLocked(), true);
  });

  it("posts to the follow-ups API path for the customer id", async () => {
    const flight = createFollowUpSubmitFlight();
    let url = "";
    let method = "";
    let payload: unknown;
    const fetchImpl: typeof fetch = async (input, init) => {
      url = String(input);
      method = String(init?.method ?? "");
      payload = JSON.parse(String(init?.body ?? "{}"));
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };

    const body = validBody();
    await postFollowUpCreateOnce({
      flight,
      customerId: "cust-xyz",
      body,
      fetchImpl,
    });
    assert.equal(url, "/api/customers/cust-xyz/follow-ups");
    assert.equal(method, "POST");
    assert.deepEqual(payload, body);
  });
});

describe("follow-up create form single-flight wiring", () => {
  it("uses per-mount useRef flight and postFollowUpCreateOnce", () => {
    assert.match(formSource, /createFollowUpSubmitFlight/);
    assert.match(formSource, /postFollowUpCreateOnce/);
    assert.match(formSource, /useRef\(createFollowUpSubmitFlight\(\)\)/);
    assert.match(formSource, /submitFlightRef/);
    assert.match(formSource, /onAcquired:\s*\(\)\s*=>\s*\{[\s\S]*setSubmitting\(true\)/);
  });

  it("validates before acquire and does not unlock on success", () => {
    assert.match(formSource, /validateFollowUpInput/);
    const validationIdx = formSource.indexOf("validateFollowUpInput");
    const postIdx = formSource.indexOf("postFollowUpCreateOnce");
    assert.ok(validationIdx > 0 && postIdx > validationIdx);

    const successBlock = formSource.match(
      /if \(res\.ok\) \{[\s\S]*?return;\n      \}/,
    );
    assert.ok(successBlock);
    assert.match(successBlock[0], /router\.push/);
    assert.doesNotMatch(successBlock[0], /unlockSubmitFlight/);
    assert.doesNotMatch(formSource, /finally\s*\{[\s\S]*setSubmitting\(false\)/);
  });

  it("releases on HTTP and network failure paths", () => {
    assert.match(formSource, /network_error[\s\S]*unlockSubmitFlight/);
    assert.match(formSource, /unlockSubmitFlight\(\)/);
    assert.match(formSource, /disabled=\{submitting\}/);
    assert.match(formSource, /customers\.saving/);
  });

  it("keeps a single shared form submit path (mobile and desktop)", () => {
    assert.equal((formSource.match(/async function handleSubmit/g) || []).length, 1);
    assert.equal((formSource.match(/type="submit"/g) || []).length, 1);
    assert.doesNotMatch(formSource, /debounce/);
    assert.doesNotMatch(formSource, /Toast|toast/);
  });
});
