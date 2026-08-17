export { isStateV2ShadowGloballyEnabled } from "./config";
export {
  isShadowCircuitOpen,
  recordShadowFailure,
  recordShadowSuccess,
  resetShadowCircuitForTests,
  getShadowCircuitStateForTests,
} from "./circuit-breaker";
export { isShadowSampleRequest, hashShadowSeed } from "./sampling";
export {
  getShadowTelemetrySnapshot,
  resetShadowTelemetryForTests,
  assertShadowTelemetryHasNoPii,
  type ShadowTelemetryCounters,
  type ShadowComparisonCategory,
} from "./telemetry";
export {
  maybeEmitShadowTelemetryLog,
  setShadowLogSinkForTests,
  resetShadowTelemetryLogForTests,
  assertShadowAggregateLogHasNoPii,
  SHADOW_CUSTOMERS_EMIT_THRESHOLD,
  SHADOW_TIME_EMIT_MS,
} from "./telemetry-log";
export { recordLegacyToV2Comparisons } from "./compare";
export {
  maybeRunStateV2ShadowBatch,
  buildStateV2ShadowListRequestSeed,
  buildStateV2ShadowDetailRequestSeed,
  type StateV2ShadowBatchInput,
  type StateV2ShadowCustomerInput,
  type StateV2ShadowRoute,
} from "./run";
