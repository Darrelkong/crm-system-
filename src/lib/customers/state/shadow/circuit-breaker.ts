const ERROR_THRESHOLD = 5;
const COOLDOWN_MS = 60_000;

type CircuitState = {
  consecutiveErrors: number;
  openUntilMs: number;
};

const circuit: CircuitState = {
  consecutiveErrors: 0,
  openUntilMs: 0,
};

export function isShadowCircuitOpen(nowMs: number = Date.now()): boolean {
  return nowMs < circuit.openUntilMs;
}

export function recordShadowSuccess(): void {
  circuit.consecutiveErrors = 0;
}

export function recordShadowFailure(nowMs: number = Date.now()): void {
  circuit.consecutiveErrors += 1;
  if (circuit.consecutiveErrors >= ERROR_THRESHOLD) {
    circuit.openUntilMs = nowMs + COOLDOWN_MS;
    circuit.consecutiveErrors = 0;
  }
}

export function resetShadowCircuitForTests(): void {
  circuit.consecutiveErrors = 0;
  circuit.openUntilMs = 0;
}

export function getShadowCircuitStateForTests(): Readonly<CircuitState> {
  return { ...circuit };
}
