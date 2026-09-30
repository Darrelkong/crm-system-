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
  submissionId: () => string;
  complete: () => void;
};

export function createFollowUpSubmitFlight(): FollowUpSubmitFlight {
  let locked = false;
  let completed = false;
  let submissionId: string | undefined;

  return {
    acquire() {
      if (locked) {
        return false;
      }
      locked = true;
      return true;
    },
    release() {
      if (completed) return;
      locked = false;
    },
    submissionId() {
      return submissionId ??= crypto.randomUUID();
    },
    complete() {
      completed = true;
      locked = true;
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
        body: JSON.stringify({
          ...(options.body as Record<string, unknown>),
          submissionId: options.flight.submissionId(),
        }),
      },
    );
    return { status: "response", response };
  } catch (error) {
    options.flight.release();
    return { status: "network_error", error };
  }
}
