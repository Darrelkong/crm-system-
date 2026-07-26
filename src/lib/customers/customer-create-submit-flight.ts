/**
 * Sync single-flight lock for new-customer POST.
 * Must be acquired before any await so same-tick double clicks cannot dual-submit.
 */

export type CustomerCreateSubmitFlight = {
  /** Returns false when a POST is already in flight. */
  acquire: () => boolean;
  /** Unlock after API/network failure so the user can retry. */
  release: () => void;
  isInFlight: () => boolean;
};

export function createCustomerCreateSubmitFlight(): CustomerCreateSubmitFlight {
  let inFlight = false;

  return {
    acquire() {
      if (inFlight) {
        return false;
      }
      inFlight = true;
      return true;
    },
    release() {
      inFlight = false;
    },
    isInFlight() {
      return inFlight;
    },
  };
}

export type GuardedCustomerCreatePostResult =
  | { status: "blocked" }
  | { status: "network_error"; error: unknown }
  | { status: "response"; response: Response };

/**
 * Testable POST gate used by the new-customer form.
 * Success keeps the flight locked; network errors release it.
 * HTTP error statuses leave the lock held — caller must release to allow retry.
 */
export async function postCustomerCreateOnce(options: {
  flight: CustomerCreateSubmitFlight;
  body: unknown;
  fetchImpl?: typeof fetch;
  /** Called synchronously after the flight lock is acquired, before any await. */
  onAcquired?: () => void;
}): Promise<GuardedCustomerCreatePostResult> {
  if (!options.flight.acquire()) {
    return { status: "blocked" };
  }

  options.onAcquired?.();

  const fetchImpl = options.fetchImpl ?? fetch;
  try {
    const response = await fetchImpl("/api/customers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(options.body),
    });
    return { status: "response", response };
  } catch (error) {
    options.flight.release();
    return { status: "network_error", error };
  }
}
