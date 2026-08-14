/**
 * Debounced local draft autosave for the new-customer form.
 * Keeps write-block / timer cancellation testable without mounting React.
 */

import {
  CUSTOMER_CREATE_DRAFT_DEBOUNCE_MS,
  clearCustomerCreateDraft,
  saveCustomerCreateDraft,
  type CustomerCreateDraftFormData,
  type CustomerCreateDraftPayload,
  type CustomerCreateDraftScope,
} from "@/lib/customers/customer-create-draft";

export type DraftAutosavePersistResult =
  | { ok: true; value: CustomerCreateDraftPayload | null }
  | { ok: false; reason: "unavailable" | "invalid" | "expired" | "missing" };

export type DraftAutosaveController = {
  /** Allow scheduling after restore / discard / initial empty ready. */
  setReady: (ready: boolean) => void;
  isReady: () => boolean;
  isWriteBlocked: () => boolean;
  /** Clear permanent block when the form binds to a different userId (same instance). */
  resetWriteBlock: () => void;
  /** Schedule a debounced save while editing. No-op when blocked / not ready / submitting. */
  schedule: (
    userId: string,
    form: CustomerCreateDraftFormData,
    submitting: boolean,
    scope?: CustomerCreateDraftScope,
  ) => void;
  cancelPending: () => void;
  /**
   * Permanent for this controller instance: block writes, cancel timer, clear storage.
   * Idempotent.
   */
  finalizeAccepted: (
    userId: string,
    scope?: CustomerCreateDraftScope,
  ) => void;
  /**
   * Discard draft but keep autosave enabled for later edits.
   */
  discard: (userId: string, scope?: CustomerCreateDraftScope) => void;
  dispose: () => void;
};

export type CreateDraftAutosaveOptions = {
  debounceMs?: number;
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
  onPersisted?: (result: DraftAutosavePersistResult) => void;
};

export function createCustomerCreateDraftAutosave(
  options: CreateDraftAutosaveOptions = {},
): DraftAutosaveController {
  const debounceMs = options.debounceMs ?? CUSTOMER_CREATE_DRAFT_DEBOUNCE_MS;
  const setTimeoutFn = options.setTimeoutFn ?? setTimeout;
  const clearTimeoutFn = options.clearTimeoutFn ?? clearTimeout;
  const onPersisted = options.onPersisted;

  let ready = false;
  let writeBlocked = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function cancelPending(): void {
    if (timer != null) {
      clearTimeoutFn(timer);
      timer = null;
    }
  }

  function setReady(next: boolean): void {
    ready = next;
  }

  function resetWriteBlock(): void {
    writeBlocked = false;
  }

  function resolveScope(
    scope?: CustomerCreateDraftScope,
  ): CustomerCreateDraftScope {
    return scope ?? { kind: "standard" };
  }

  function schedule(
    userId: string,
    form: CustomerCreateDraftFormData,
    submitting: boolean,
    scope?: CustomerCreateDraftScope,
  ): void {
    if (writeBlocked || !ready || submitting) {
      return;
    }

    cancelPending();
    const resolvedScope = resolveScope(scope);

    timer = setTimeoutFn(() => {
      timer = null;
      // Re-check after debounce: submit may have succeeded while waiting.
      if (writeBlocked || !ready) {
        return;
      }
      const result = saveCustomerCreateDraft(
        userId,
        form,
        Date.now(),
        resolvedScope,
      );
      onPersisted?.(result);
    }, debounceMs);
  }

  function finalizeAccepted(
    userId: string,
    scope?: CustomerCreateDraftScope,
  ): void {
    writeBlocked = true;
    cancelPending();
    clearCustomerCreateDraft(userId, resolveScope(scope));
  }

  function discard(userId: string, scope?: CustomerCreateDraftScope): void {
    cancelPending();
    clearCustomerCreateDraft(userId, resolveScope(scope));
    writeBlocked = false;
    ready = true;
  }

  function dispose(): void {
    cancelPending();
  }

  return {
    setReady,
    isReady: () => ready,
    isWriteBlocked: () => writeBlocked,
    resetWriteBlock,
    schedule,
    cancelPending,
    finalizeAccepted,
    discard,
    dispose,
  };
}
