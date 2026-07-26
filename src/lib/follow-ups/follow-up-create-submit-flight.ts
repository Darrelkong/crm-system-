/**
 * Sync single-flight lock for new-follow-up POST.
 * Must be acquired before any await so same-tick multi-clicks cannot dual-submit.
 */

export type FollowUpSubmitFlight = {
  /** Returns false when a POST is already in flight. */
  acquire: () => boolean;
  /** Unlock after API/network failure so the user can retry. */
  release: () => void;
  isLocked: () => boolean;
};

export function createFollowUpSubmitFlight(): FollowUpSubmitFlight {
  let locked = false;

  return {
    acquire() {
      if (locked) {
        return false;
      }
      locked = true;
      return true;
    },
    release() {
      locked = false;
    },
    isLocked() {
      return locked;
    },
  };
}

export type GuardedFollowUpCreatePostResult =
  | { status: "blocked" }
  | { status: "network_error"; error: unknown }
  | { status: "response"; response: Response };

/**
 * Testable POST gate for new-follow-up form.
 * Success keeps the flight locked; network errors release it.
 * HTTP error statuses leave the lock held — caller must release to allow retry.
 */
export async function postFollowUpCreateOnce(options: {
  flight: FollowUpSubmitFlight;
  customerId: string;
  body: unknown;
  fetchImpl?: typeof fetch;
  /** Called synchronously after the flight lock is acquired, before any await. */
  onAcquired?: () => void;
}): Promise<GuardedFollowUpCreatePostResult> {
  if (!options.flight.acquire()) {
    return { status: "blocked" };
  }

  options.onAcquired?.();

  const fetchImpl = options.fetchImpl ?? fetch;
  try {
    const response = await fetchImpl(
      `/api/customers/${options.customerId}/follow-ups`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(options.body),
      },
    );
    return { status: "response", response };
  } catch (error) {
    options.flight.release();
    return { status: "network_error", error };
  }
}
