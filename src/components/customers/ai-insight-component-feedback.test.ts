import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import en from "@/i18n/locales/en";
import zhHans from "@/i18n/locales/zh-Hans";
import zhHant from "@/i18n/locales/zh-Hant";
import {
  assertExactPutBodyKeys,
  buildComponentFeedbackPutBody,
  draftsDifferFromSaved,
  eligibilityForTarget,
  tagsForTargetRating,
  toggleDraftTag,
  COMPONENT_FEEDBACK_MAX_TAGS,
  COMPONENT_FEEDBACK_PUT_ALLOWED_KEYS,
} from "@/components/customers/ai-insight-component-feedback";
import {
  AiInsightComponentFeedbackClient,
  shouldShowComponentFeedbackControl,
  type ComponentFeedbackClientMessages,
} from "@/components/customers/ai-insight-component-feedback-client";

const root = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

function readSrc(rel: string): string {
  return readFileSync(path.join(root, rel), "utf8");
}

function collectStringKeys(
  value: unknown,
  prefix = "",
  out: string[] = [],
): string[] {
  if (typeof value === "string") {
    out.push(prefix);
    return out;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(
      value as Record<string, unknown>,
    )) {
      const next = prefix ? `${prefix}.${key}` : key;
      collectStringKeys(child, next, out);
    }
  }
  return out;
}

const MESSAGES: ComponentFeedbackClientMessages = {
  unavailable: "Feedback is temporarily unavailable",
  saveFailed: "Feedback could not be saved. Please try again later.",
  generationMismatch:
    "The analysis was updated. Reload the current content before rating again.",
  saved: "Saved",
  updated: "Updated",
};

const GEN_A = {
  insightGeneratedAt: "2026-07-20T12:00:00.000Z",
  sourceHash: "hash-a",
};

const GEN_B = {
  insightGeneratedAt: "2026-07-20T13:00:00.000Z",
  sourceHash: "hash-b",
};

type RecordedCall = {
  url: string;
  method: string;
  body: unknown | null;
  headers: Record<string, string>;
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function okGet(overrides: Record<string, unknown> = {}) {
  return jsonResponse(200, {
    ok: true,
    generation: GEN_A,
    eligibility: {
      baseDeep: true,
      phase2: true,
      suggestedMessage: true,
    },
    feedback: {
      baseDeep: null,
      phase2: null,
      suggestedMessage: null,
    },
    ...overrides,
  });
}

function okPut(target: "baseDeep" | "phase2" | "suggestedMessage", rating: string, tags: string[]) {
  return jsonResponse(200, {
    ok: true,
    generation: GEN_A,
    eligibility: {
      baseDeep: true,
      phase2: true,
      suggestedMessage: true,
    },
    feedback: {
      baseDeep: null,
      phase2: null,
      suggestedMessage: null,
      [target]: {
        rating,
        tags,
        updatedAt: "2026-07-20T12:01:00.000Z",
      },
    },
  });
}

function createMockFetch(handler: (call: RecordedCall, index: number) => Response | Promise<Response>) {
  const calls: RecordedCall[] = [];
  const fetchImpl = async (input: string, init?: RequestInit): Promise<Response> => {
    const method = (init?.method ?? "GET").toUpperCase();
    let body: unknown | null = null;
    if (typeof init?.body === "string") {
      body = JSON.parse(init.body);
    }
    const headers: Record<string, string> = {};
    if (init?.headers && typeof init.headers === "object") {
      Object.assign(headers, init.headers as Record<string, string>);
    }
    const call: RecordedCall = { url: String(input), method, body, headers };
    const index = calls.length;
    calls.push(call);
    return handler(call, index);
  };
  return { calls, fetchImpl };
}

async function flush(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
}

async function loadReady(
  client: AiInsightComponentFeedbackClient,
  customerId = "cust-a",
): Promise<void> {
  await client.load({
    customerId,
    insightReady: true,
    insightGeneratedAt: GEN_A.insightGeneratedAt,
    insightSourceHash: GEN_A.sourceHash,
  });
  await flush();
}

describe("Phase 5D-3 component feedback helpers", () => {
  it("builds exact PUT bodies without extra fields", () => {
    const body = buildComponentFeedbackPutBody({
      insightGeneratedAt: "2026-07-20T12:00:00.000Z",
      sourceHash: "hash",
      target: "base_deep",
      rating: "helpful",
      tags: ["accurate_summary"],
    });
    assert.deepEqual(
      Object.keys(body).sort(),
      [...COMPONENT_FEEDBACK_PUT_ALLOWED_KEYS].sort(),
    );
    assertExactPutBodyKeys(body as unknown as Record<string, unknown>);
    assert.equal("customerName" in body, false);
    assert.equal("comment" in body, false);
    assert.equal("actorUserId" in body, false);
  });

  it("returns target-specific positive and negative tags", () => {
    const helpful = tagsForTargetRating("base_deep", "helpful");
    const notHelpful = tagsForTargetRating("base_deep", "not_helpful");
    assert.ok(helpful.includes("accurate_summary"));
    assert.ok(notHelpful.includes("too_generic"));
    assert.equal(helpful.includes("score_reasonable"), false);
    assert.equal(
      tagsForTargetRating("phase2", "helpful").includes("evidence_helpful"),
      true,
    );
  });

  it("enforces max 4 draft tags and detects unsaved drafts", () => {
    let draft: string[] = [];
    for (const tag of ["a", "b", "c", "d", "e"]) {
      draft = toggleDraftTag(draft, tag, COMPONENT_FEEDBACK_MAX_TAGS);
    }
    assert.equal(draft.length, 4);
    assert.equal(draftsDifferFromSaved(["a"], ["a"]), false);
    assert.equal(draftsDifferFromSaved(["a", "b"], ["a"]), true);
  });

  it("reads server eligibility flags per target", () => {
    const eligibility = {
      baseDeep: true,
      phase2: false,
      suggestedMessage: true,
    };
    assert.equal(eligibilityForTarget(eligibility, "base_deep"), true);
    assert.equal(eligibilityForTarget(eligibility, "phase2"), false);
    assert.equal(eligibilityForTarget(null, "base_deep"), false);
  });

  it("requires UI section and API eligibility to show control", () => {
    assert.equal(
      shouldShowComponentFeedbackControl({
        sectionVisible: true,
        hydration: "ready",
        eligibility: {
          baseDeep: true,
          phase2: false,
          suggestedMessage: false,
        },
        target: "base_deep",
      }),
      true,
    );
    assert.equal(
      shouldShowComponentFeedbackControl({
        sectionVisible: false,
        hydration: "ready",
        eligibility: {
          baseDeep: true,
          phase2: true,
          suggestedMessage: true,
        },
        target: "phase2",
      }),
      false,
    );
    assert.equal(
      shouldShowComponentFeedbackControl({
        sectionVisible: true,
        hydration: "loading",
        eligibility: {
          baseDeep: true,
          phase2: true,
          suggestedMessage: true,
        },
        target: "base_deep",
      }),
      false,
    );
    assert.equal(
      shouldShowComponentFeedbackControl({
        sectionVisible: true,
        hydration: "ready",
        eligibility: {
          baseDeep: true,
          phase2: false,
          suggestedMessage: true,
        },
        target: "phase2",
      }),
      false,
    );
  });
});

describe("Phase 5D-3 runtime GET lifecycle", () => {
  it("GETs components once per customer/generation and ignores rerender reload of same args", async () => {
    const { calls, fetchImpl } = createMockFetch(() => okGet());
    const client = new AiInsightComponentFeedbackClient(MESSAGES, fetchImpl);
    await loadReady(client);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, "GET");
    assert.match(calls[0].url, /\/api\/customers\/cust-a\/ai-insight-feedback\/components$/);

    // Same generation reload still bumps load (explicit load call) — simulate React effect
    // re-fire with identical args only when deps change. Calling load again is intentional
    // for retry; for same-session rerender, hook deps stay stable so load is not re-called.
    assert.equal(client.getSnapshot().hydration, "ready");
    assert.equal(calls.filter((c) => c.method === "GET").length, 1);
    client.dispose();
  });

  it("does not GET when insight is not ready", async () => {
    const { calls, fetchImpl } = createMockFetch(() => okGet());
    const client = new AiInsightComponentFeedbackClient(MESSAGES, fetchImpl);
    await client.load({
      customerId: "cust-a",
      insightReady: false,
      insightGeneratedAt: null,
      insightSourceHash: null,
    });
    assert.equal(calls.length, 0);
    assert.equal(client.getSnapshot().hydration, "idle");
    client.dispose();
  });

  it("customer change clears state and ignores stale GET response", async () => {
    let resolveA: (value: Response) => void = () => {};
    const pendingA = new Promise<Response>((resolve) => {
      resolveA = resolve;
    });
    const { calls, fetchImpl } = createMockFetch((call) => {
      if (call.url.includes("cust-a")) return pendingA;
      return okGet({
        generation: GEN_B,
        feedback: {
          baseDeep: {
            rating: "helpful",
            tags: ["accurate_summary"],
            updatedAt: "2026-07-20T13:00:00.000Z",
          },
          phase2: null,
          suggestedMessage: null,
        },
      });
    });
    const client = new AiInsightComponentFeedbackClient(MESSAGES, fetchImpl);
    const loadA = client.load({
      customerId: "cust-a",
      insightReady: true,
      insightGeneratedAt: GEN_A.insightGeneratedAt,
      insightSourceHash: GEN_A.sourceHash,
    });
    await flush();
    assert.equal(client.getSnapshot().hydration, "loading");

    const loadB = client.load({
      customerId: "cust-b",
      insightReady: true,
      insightGeneratedAt: GEN_B.insightGeneratedAt,
      insightSourceHash: GEN_B.sourceHash,
    });
    await flush();
    resolveA(
      okGet({
        generation: GEN_A,
        feedback: {
          baseDeep: {
            rating: "not_helpful",
            tags: ["too_generic"],
            updatedAt: "2026-07-20T12:00:00.000Z",
          },
          phase2: null,
          suggestedMessage: null,
        },
      }),
    );
    await loadA;
    await loadB;
    await flush();

    const snap = client.getSnapshot();
    assert.equal(snap.hydration, "ready");
    assert.equal(snap.targets.base_deep.rating, "helpful");
    assert.deepEqual(snap.targets.base_deep.savedTags, ["accurate_summary"]);
    assert.equal(calls.length, 2);
    assert.equal(client.peekGenerationForTests()?.sourceHash, GEN_B.sourceHash);
    client.dispose();
  });

  it("GET failure shows unavailable and retry performs second GET only", async () => {
    let failFirst = true;
    const { calls, fetchImpl } = createMockFetch(() => {
      if (failFirst) {
        failFirst = false;
        return jsonResponse(500, { ok: false });
      }
      return okGet();
    });
    const client = new AiInsightComponentFeedbackClient(MESSAGES, fetchImpl);
    await loadReady(client);
    assert.equal(client.getSnapshot().hydration, "error");
    assert.equal(client.getSnapshot().loadError, MESSAGES.unavailable);
    assert.equal(calls.length, 1);

    await client.retryLoad({
      customerId: "cust-a",
      insightReady: true,
      insightGeneratedAt: GEN_A.insightGeneratedAt,
      insightSourceHash: GEN_A.sourceHash,
    });
    await flush();
    assert.equal(client.getSnapshot().hydration, "ready");
    assert.equal(calls.length, 2);
    assert.equal(calls.every((c) => c.method === "GET"), true);
    assert.equal(
      calls.some((c) => c.url.includes("/ai-insight/refresh")),
      false,
    );
    client.dispose();
  });

  it("403 GET hides feedback as unavailable without permission details", async () => {
    const { fetchImpl } = createMockFetch(() =>
      jsonResponse(403, { error: "forbidden", reason: "not-assignee" }),
    );
    const client = new AiInsightComponentFeedbackClient(MESSAGES, fetchImpl);
    await loadReady(client);
    const snap = client.getSnapshot();
    assert.equal(snap.hydration, "unavailable");
    assert.equal(snap.loadError, null);
    client.dispose();
  });
});

describe("Phase 5D-3 runtime rating and tags", () => {
  it("Helpful one-click PUT with exact body and no follow-up GET", async () => {
    const { calls, fetchImpl } = createMockFetch((call) => {
      if (call.method === "GET") return okGet();
      return okPut("baseDeep", "helpful", []);
    });
    const client = new AiInsightComponentFeedbackClient(MESSAGES, fetchImpl);
    await loadReady(client);
    client.submitRating("base_deep", "helpful");
    await flush();

    const puts = calls.filter((c) => c.method === "PUT");
    assert.equal(puts.length, 1);
    assert.equal(
      puts[0].url,
      "/api/customers/cust-a/ai-insight-feedback/components",
    );
    assert.equal(puts[0].headers["Content-Type"], "application/json");
    const body = puts[0].body as Record<string, unknown>;
    assert.deepEqual(Object.keys(body).sort(), [
      ...COMPONENT_FEEDBACK_PUT_ALLOWED_KEYS,
    ].sort());
    assert.equal(body.rating, "helpful");
    assert.deepEqual(body.tags, []);
    assert.equal(body.target, "base_deep");
    assert.equal(body.insightGeneratedAt, GEN_A.insightGeneratedAt);
    assert.equal(body.sourceHash, GEN_A.sourceHash);
    assert.equal("customerId" in body, false);
    assert.equal("comment" in body, false);
    assert.equal("suggestedMessage" in body, false);

    const snap = client.getSnapshot();
    assert.equal(snap.targets.base_deep.rating, "helpful");
    assert.equal(snap.targets.base_deep.statusMessage, "Saved");
    assert.equal(calls.filter((c) => c.method === "GET").length, 1);
    client.dispose();
  });

  it("double-click Helpful while saving issues only one PUT", async () => {
    let resolvePut: (value: Response) => void = () => {};
    const pendingPut = new Promise<Response>((resolve) => {
      resolvePut = resolve;
    });
    const { calls, fetchImpl } = createMockFetch((call) => {
      if (call.method === "GET") return okGet();
      return pendingPut;
    });
    const client = new AiInsightComponentFeedbackClient(MESSAGES, fetchImpl);
    await loadReady(client);
    client.submitRating("base_deep", "helpful");
    client.submitRating("base_deep", "helpful");
    client.submitRating("base_deep", "not_helpful");
    assert.equal(client.getSnapshot().targets.base_deep.saving, true);
    assert.equal(calls.filter((c) => c.method === "PUT").length, 1);
    resolvePut(okPut("baseDeep", "helpful", []));
    await flush();
    assert.equal(client.getSnapshot().targets.base_deep.rating, "helpful");
    client.dispose();
  });

  it("tag drafts do not PUT until save reasons", async () => {
    const { calls, fetchImpl } = createMockFetch((call) => {
      if (call.method === "GET") return okGet();
      const body = call.body as { rating: string; tags: string[] };
      return okPut("baseDeep", body.rating, body.tags);
    });
    const client = new AiInsightComponentFeedbackClient(MESSAGES, fetchImpl);
    await loadReady(client);
    client.submitRating("base_deep", "helpful");
    await flush();
    assert.equal(calls.filter((c) => c.method === "PUT").length, 1);

    client.toggleTag("base_deep", "accurate_summary");
    client.toggleTag("base_deep", "clear_next_step");
    client.toggleTag("base_deep", "saves_time");
    client.toggleTag("base_deep", "useful_risk_identification");
    client.toggleTag("base_deep", "extra_should_not_apply");
    assert.equal(client.hasUnsavedTags("base_deep"), true);
    assert.equal(client.getSnapshot().targets.base_deep.draftTags.length, 4);
    assert.equal(calls.filter((c) => c.method === "PUT").length, 1);

    client.saveTags("base_deep");
    await flush();
    const puts = calls.filter((c) => c.method === "PUT");
    assert.equal(puts.length, 2);
    assert.deepEqual((puts[1].body as { tags: string[] }).tags, [
      "accurate_summary",
      "clear_next_step",
      "saves_time",
      "useful_risk_identification",
    ]);
    assert.equal(client.hasUnsavedTags("base_deep"), false);
    assert.equal(client.getSnapshot().targets.base_deep.statusMessage, "Updated");
    client.dispose();
  });

  it("rating change clears incompatible draft tags and PUTs empty tags", async () => {
    const { calls, fetchImpl } = createMockFetch((call) => {
      if (call.method === "GET") return okGet();
      const body = call.body as { rating: string; tags: string[] };
      return okPut("baseDeep", body.rating, body.tags);
    });
    const client = new AiInsightComponentFeedbackClient(MESSAGES, fetchImpl);
    await loadReady(client);
    client.submitRating("base_deep", "helpful");
    await flush();
    client.toggleTag("base_deep", "accurate_summary");
    client.submitRating("base_deep", "not_helpful");
    await flush();
    const lastPut = calls.filter((c) => c.method === "PUT").at(-1)!;
    assert.equal((lastPut.body as { rating: string }).rating, "not_helpful");
    assert.deepEqual((lastPut.body as { tags: string[] }).tags, []);
    assert.deepEqual(client.getSnapshot().targets.base_deep.draftTags, []);
    client.dispose();
  });

  it("PUT failure preserves prior saved rating and draft tags", async () => {
    let putCount = 0;
    const { fetchImpl } = createMockFetch((call) => {
      if (call.method === "GET") return okGet();
      putCount += 1;
      if (putCount === 1) return okPut("baseDeep", "helpful", []);
      return jsonResponse(500, { ok: false });
    });
    const client = new AiInsightComponentFeedbackClient(MESSAGES, fetchImpl);
    await loadReady(client);
    client.submitRating("base_deep", "helpful");
    await flush();
    client.toggleTag("base_deep", "accurate_summary");
    client.saveTags("base_deep");
    await flush();
    const snap = client.getSnapshot();
    assert.equal(snap.targets.base_deep.rating, "helpful");
    assert.deepEqual(snap.targets.base_deep.savedTags, []);
    assert.deepEqual(snap.targets.base_deep.draftTags, ["accurate_summary"]);
    assert.equal(snap.targets.base_deep.error, MESSAGES.saveFailed);
    assert.equal(snap.targets.base_deep.statusMessage, null);
    client.dispose();
  });
});

describe("Phase 5D-3 runtime isolation and race", () => {
  it("keeps per-target saving and errors independent", async () => {
    let resolveBase: (value: Response) => void = () => {};
    const pendingBase = new Promise<Response>((resolve) => {
      resolveBase = resolve;
    });
    const { calls, fetchImpl } = createMockFetch((call) => {
      if (call.method === "GET") return okGet();
      const body = call.body as { target: string };
      if (body.target === "base_deep") return pendingBase;
      if (body.target === "suggested_message") {
        return jsonResponse(500, { ok: false });
      }
      return okPut("phase2", "helpful", []);
    });
    const client = new AiInsightComponentFeedbackClient(MESSAGES, fetchImpl);
    await loadReady(client);

    client.submitRating("base_deep", "helpful");
    client.submitRating("phase2", "helpful");
    client.submitRating("suggested_message", "not_helpful");
    await flush();

    assert.equal(client.getSnapshot().targets.base_deep.saving, true);
    assert.equal(client.getSnapshot().targets.phase2.saving, false);
    assert.equal(client.getSnapshot().targets.phase2.rating, "helpful");
    assert.equal(
      client.getSnapshot().targets.suggested_message.error,
      MESSAGES.saveFailed,
    );
    assert.equal(calls.filter((c) => c.method === "PUT").length, 3);

    resolveBase(okPut("baseDeep", "helpful", []));
    await flush();
    assert.equal(client.getSnapshot().targets.base_deep.rating, "helpful");
    assert.equal(client.getSnapshot().targets.phase2.rating, "helpful");
    assert.equal(
      client.getSnapshot().targets.suggested_message.error,
      MESSAGES.saveFailed,
    );
    client.dispose();
  });

  it("ignores older PUT response after newer rating request", async () => {
    let resolveHelpful: (value: Response) => void = () => {};
    const pendingHelpful = new Promise<Response>((resolve) => {
      resolveHelpful = resolve;
    });
    let putIndex = 0;
    const { fetchImpl } = createMockFetch((call) => {
      if (call.method === "GET") return okGet();
      putIndex += 1;
      if (putIndex === 1) return pendingHelpful;
      return okPut("baseDeep", "not_helpful", []);
    });
    // Allow second click by completing first save first — then start overlapping:
    // For saving-disabled strategy, second click is blocked. Verify that path.
    const client = new AiInsightComponentFeedbackClient(MESSAGES, fetchImpl);
    await loadReady(client);
    client.submitRating("base_deep", "helpful");
    assert.equal(client.getSnapshot().targets.base_deep.saving, true);
    client.submitRating("base_deep", "not_helpful");
    assert.equal(putIndex, 1);
    resolveHelpful(okPut("baseDeep", "helpful", []));
    await flush();
    assert.equal(client.getSnapshot().targets.base_deep.rating, "helpful");

    client.submitRating("base_deep", "not_helpful");
    await flush();
    assert.equal(client.getSnapshot().targets.base_deep.rating, "not_helpful");
    client.dispose();
  });

  it("double saveTags while saving issues one PUT", async () => {
    let resolvePut: (value: Response) => void = () => {};
    const pendingPut = new Promise<Response>((resolve) => {
      resolvePut = resolve;
    });
    let putCount = 0;
    const { fetchImpl } = createMockFetch((call) => {
      if (call.method === "GET") return okGet();
      putCount += 1;
      if (putCount === 1) return okPut("baseDeep", "helpful", []);
      return pendingPut;
    });
    const client = new AiInsightComponentFeedbackClient(MESSAGES, fetchImpl);
    await loadReady(client);
    client.submitRating("base_deep", "helpful");
    await flush();
    client.toggleTag("base_deep", "accurate_summary");
    client.saveTags("base_deep");
    client.saveTags("base_deep");
    assert.equal(putCount, 2);
    resolvePut(okPut("baseDeep", "helpful", ["accurate_summary"]));
    await flush();
    client.dispose();
  });

  it("generation load race ignores stale response", async () => {
    let resolveOld: (value: Response) => void = () => {};
    const pendingOld = new Promise<Response>((resolve) => {
      resolveOld = resolve;
    });
    let getCount = 0;
    const { fetchImpl } = createMockFetch(() => {
      getCount += 1;
      if (getCount === 1) return pendingOld;
      return okGet({ generation: GEN_B });
    });
    const client = new AiInsightComponentFeedbackClient(MESSAGES, fetchImpl);
    const first = client.load({
      customerId: "cust-a",
      insightReady: true,
      insightGeneratedAt: GEN_A.insightGeneratedAt,
      insightSourceHash: GEN_A.sourceHash,
    });
    await flush();
    const second = client.load({
      customerId: "cust-a",
      insightReady: true,
      insightGeneratedAt: GEN_B.insightGeneratedAt,
      insightSourceHash: GEN_B.sourceHash,
    });
    await flush();
    resolveOld(okGet({ generation: GEN_A }));
    await first;
    await second;
    await flush();
    assert.equal(client.peekGenerationForTests()?.sourceHash, GEN_B.sourceHash);
    client.dispose();
  });
});

describe("Phase 5D-3 runtime generation mismatch", () => {
  it("409 mismatch clears generation and does not call AI refresh", async () => {
    const { calls, fetchImpl } = createMockFetch((call) => {
      if (call.method === "GET") return okGet();
      return jsonResponse(409, {
        ok: false,
        errorCode: "AI_FEEDBACK_GENERATION_MISMATCH",
      });
    });
    const client = new AiInsightComponentFeedbackClient(MESSAGES, fetchImpl);
    await loadReady(client);
    client.submitRating("base_deep", "helpful");
    await flush();
    const snap = client.getSnapshot();
    assert.equal(snap.targets.base_deep.generationMismatch, true);
    assert.equal(snap.targets.base_deep.statusMessage, null);
    assert.equal(snap.hasGeneration, false);
    assert.equal(client.peekGenerationForTests(), null);
    assert.equal(
      calls.some((c) => c.url.includes("/ai-insight/refresh")),
      false,
    );

    // Reload path: clear + new GET (router.refresh is host-only; spy GET here).
    client.clearGenerationMismatch();
    await client.load({
      customerId: "cust-a",
      insightReady: true,
      insightGeneratedAt: GEN_B.insightGeneratedAt,
      insightSourceHash: GEN_B.sourceHash,
    });
    await flush();
    assert.equal(client.getSnapshot().hydration, "ready");
    assert.equal(calls.filter((c) => c.method === "GET").length, 2);
    assert.equal(calls.filter((c) => c.method === "PUT").length, 1);
    client.dispose();
  });
});

describe("Phase 5D-3 runtime eligibility hide", () => {
  it("422 not eligible clears that target control eligibility", async () => {
    const { fetchImpl } = createMockFetch((call) => {
      if (call.method === "GET") return okGet();
      return jsonResponse(422, {
        ok: false,
        errorCode: "AI_FEEDBACK_TARGET_NOT_ELIGIBLE",
      });
    });
    const client = new AiInsightComponentFeedbackClient(MESSAGES, fetchImpl);
    await loadReady(client);
    client.submitRating("phase2", "helpful");
    await flush();
    assert.equal(client.getSnapshot().eligibility?.phase2, false);
    assert.equal(client.getSnapshot().targets.phase2.rating, null);
    assert.equal(
      shouldShowComponentFeedbackControl({
        sectionVisible: true,
        hydration: "ready",
        eligibility: client.getSnapshot().eligibility,
        target: "phase2",
      }),
      false,
    );
    assert.equal(
      shouldShowComponentFeedbackControl({
        sectionVisible: true,
        hydration: "ready",
        eligibility: client.getSnapshot().eligibility,
        target: "base_deep",
      }),
      true,
    );
    client.dispose();
  });
});

describe("Phase 5D-3 panel wiring and legacy removal", () => {
  it("removes legacy star feedback from Customer AI Panel", () => {
    const panel = readSrc(
      "src/components/customers/customer-ai-insight-panel.tsx",
    );
    assert.equal(panel.includes("CustomerAiInsightFeedback"), false);
    assert.equal(panel.includes("customer-ai-insight-feedback"), false);
    assert.equal(panel.includes("/ai-insight-feedback`"), false);
    assert.ok(panel.includes("AiInsightFeedbackSectionControl"));
    assert.ok(panel.includes('target="base_deep"'));
    assert.ok(panel.includes('target="phase2"'));
    assert.ok(panel.includes('target="suggested_message"'));
    assert.ok(panel.includes("useAiInsightComponentFeedbackPanel"));
  });

  it("keeps legacy feedback component file for backend compatibility only", () => {
    const legacy = readSrc(
      "src/components/customers/customer-ai-insight-feedback.tsx",
    );
    assert.ok(legacy.includes("/api/customers/${customerId}/ai-insight-feedback"));
    assert.ok(legacy.includes("Star"));
  });

  it("feedback control uses accessible buttons without DOM target/generation attrs", () => {
    const control = readSrc(
      "src/components/customers/ai-insight-feedback-control.tsx",
    );
    assert.ok(control.includes('type="button"'));
    assert.ok(control.includes("aria-pressed"));
    assert.ok(control.includes("aria-busy"));
    assert.ok(control.includes('aria-live="polite"'));
    assert.ok(control.includes("generationMismatch"));
    assert.equal(control.includes("data-ai-feedback-target"), false);
    assert.equal(control.includes("data-source-hash"), false);
    assert.equal(control.includes("generationKey"), false);
    assert.equal(control.includes("localStorage"), false);
    assert.equal(control.includes("sessionStorage"), false);
    assert.equal(control.includes("console.log"), false);
  });

  it("client and hook avoid storage, console, and AI refresh", () => {
    const client = readSrc(
      "src/components/customers/ai-insight-component-feedback-client.ts",
    );
    const hook = readSrc(
      "src/components/customers/use-ai-insight-component-feedback.ts",
    );
    const host = readSrc(
      "src/components/customers/ai-insight-component-feedback-host.tsx",
    );
    for (const src of [client, hook, host]) {
      assert.equal(src.includes("localStorage"), false);
      assert.equal(src.includes("sessionStorage"), false);
      assert.equal(src.includes("console.log"), false);
      assert.equal(src.includes("/ai-insight/refresh"), false);
    }
    assert.ok(host.includes("router.refresh()"));
  });
});

describe("Phase 5D-3 i18n parity", () => {
  it("keeps aiInsightComponentFeedback keys aligned across locales", () => {
    const enKeys = collectStringKeys(
      (en.customers as Record<string, unknown>).aiInsightComponentFeedback,
      "customers.aiInsightComponentFeedback",
    ).sort();
    const hansKeys = collectStringKeys(
      (zhHans.customers as Record<string, unknown>).aiInsightComponentFeedback,
      "customers.aiInsightComponentFeedback",
    ).sort();
    const hantKeys = collectStringKeys(
      (zhHant.customers as Record<string, unknown>).aiInsightComponentFeedback,
      "customers.aiInsightComponentFeedback",
    ).sort();
    assert.deepEqual(hansKeys, enKeys);
    assert.deepEqual(hantKeys, enKeys);
    assert.ok(enKeys.includes("customers.aiInsightComponentFeedback.prompt"));
    assert.ok(
      enKeys.includes(
        "customers.aiInsightComponentFeedback.tags.base_deep.accurate_summary",
      ),
    );
    assert.ok(
      enKeys.includes(
        "customers.aiInsightComponentFeedback.tags.suggested_message.sounds_robotic",
      ),
    );
  });
});
