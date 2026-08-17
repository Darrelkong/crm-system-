import {
  assertShadowTelemetryHasNoPii,
  getShadowTelemetrySnapshot,
  resetShadowTelemetryForTests,
  type ShadowTelemetryCounters,
} from "./telemetry";

export const SHADOW_CUSTOMERS_EMIT_THRESHOLD = 20;
export const SHADOW_TIME_EMIT_MS = 60_000;

type ShadowLogSink = (line: string) => void;

let logSink: ShadowLogSink = (line) => {
  console.info(line);
};

let lastEmitMs = 0;
let customersSinceEmit = 0;
let firstActivityMs = 0;

export function setShadowLogSinkForTests(sink: ShadowLogSink | null): void {
  logSink = sink ?? ((line) => {
    console.info(line);
  });
}

export function resetShadowTelemetryLogForTests(): void {
  lastEmitMs = 0;
  customersSinceEmit = 0;
  firstActivityMs = 0;
  setShadowLogSinkForTests(null);
}

export function noteShadowCustomersComparedForEmit(count: number): void {
  if (count > 0) {
    customersSinceEmit += count;
  }
}

function buildAggregateLogPayload(
  snapshot: ShadowTelemetryCounters,
  emittedAtMs: number,
): string {
  return JSON.stringify({
    type: "state_v2_shadow_aggregate",
    emittedAt: new Date(emittedAtMs).toISOString(),
    requestsConsidered: snapshot.requestsConsidered,
    requestsSampled: snapshot.requestsSampled,
    requestsSkippedUnsampled: snapshot.requestsSkippedUnsampled,
    requestsSkippedDisabled: snapshot.requestsSkippedDisabled,
    requestsSkippedCircuitOpen: snapshot.requestsSkippedCircuitOpen,
    customersCompared: snapshot.customersCompared,
    skippedInsufficientFacts: snapshot.skippedInsufficientFacts,
    shadowErrors: snapshot.shadowErrors,
    comparisons: snapshot.comparisons,
  });
}

export function maybeEmitShadowTelemetryLog(nowMs: number = Date.now()): void {
  const snapshot = getShadowTelemetrySnapshot();
  if (snapshot.requestsConsidered === 0) {
    return;
  }

  if (firstActivityMs === 0) {
    firstActivityMs = nowMs;
  }

  const countDue = customersSinceEmit >= SHADOW_CUSTOMERS_EMIT_THRESHOLD;
  const timeDue = nowMs - firstActivityMs >= SHADOW_TIME_EMIT_MS;
  if (!countDue && !timeDue) {
    return;
  }

  try {
    assertShadowTelemetryHasNoPii(snapshot);
    logSink(buildAggregateLogPayload(snapshot, nowMs));
    resetShadowTelemetryForTests();
    customersSinceEmit = 0;
    firstActivityMs = 0;
    lastEmitMs = nowMs;
  } catch {
    // Telemetry emission must never affect the primary request path.
  }
}

export function assertShadowAggregateLogHasNoPii(line: string): void {
  const forbidden = [
    "customerName",
    "phone",
    "email",
    "wechat",
    "notes",
    "followUp",
    "customerId",
    "customer_id",
    "Shadow Test",
    "13800000000",
  ];
  const lower = line.toLowerCase();
  for (const token of forbidden) {
    if (lower.includes(token.toLowerCase())) {
      throw new Error(`shadow aggregate log must not contain ${token}`);
    }
  }
}
