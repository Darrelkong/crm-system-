import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  CUSTOMER_CREATE_DRAFT_DEBOUNCE_MS,
  CUSTOMER_CREATE_DRAFT_KEY_PREFIX,
  clearCustomerCreateDraft,
  createEmptyCustomerCreateFormData,
  loadCustomerCreateDraft,
  saveCustomerCreateDraft,
} from "@/lib/customers/customer-create-draft";
import { createCustomerCreateDraftAutosave } from "@/lib/customers/customer-create-draft-autosave";

class MemoryStorage implements Storage {
  private store = new Map<string, string>();
  get length(): number {
    return this.store.size;
  }
  clear(): void {
    this.store.clear();
  }
  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  key(index: number): string | null {
    return [...this.store.keys()][index] ?? null;
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
}

type FakeTimer = {
  id: number;
  due: number;
  fn: () => void;
};

function createFakeTimers() {
  let now = 0;
  let nextId = 1;
  const timers: FakeTimer[] = [];

  function setTimeoutFn(fn: () => void, ms: number): number {
    const id = nextId++;
    timers.push({ id, due: now + ms, fn });
    return id;
  }

  function clearTimeoutFn(id: ReturnType<typeof setTimeout>): void {
    const idx = timers.findIndex((t) => t.id === (id as unknown as number));
    if (idx >= 0) timers.splice(idx, 1);
  }

  function advance(ms: number): void {
    now += ms;
    const due = timers
      .filter((t) => t.due <= now)
      .sort((a, b) => a.due - b.due);
    for (const t of due) {
      const idx = timers.findIndex((x) => x.id === t.id);
      if (idx >= 0) {
        timers.splice(idx, 1);
        t.fn();
      }
    }
  }

  return { setTimeoutFn, clearTimeoutFn, advance };
}

function meaningfulForm() {
  return {
    ...createEmptyCustomerCreateFormData(),
    customerName: "QA Race",
    requestedProjectName: "Visa consult",
    phone: "13800138000",
    wechatId: "qa_wechat",
    source: "referral",
    salesStage: "contacted",
    notes: "客戶需求與下一步安排說明足夠十個字以上",
  };
}

describe("customer-create-draft-autosave race", () => {
  let previous: Storage | undefined;

  beforeEach(() => {
    previous = globalThis.localStorage;
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: new MemoryStorage(),
    });
  });

  afterEach(() => {
    clearCustomerCreateDraft("user-race");
    clearCustomerCreateDraft("user-a");
    clearCustomerCreateDraft("user-b");
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: previous,
    });
  });

  it("does not rewrite draft after finalizeAccepted even when timers advance and submitting resumes", () => {
    const timers = createFakeTimers();
    const persisted: unknown[] = [];
    const autosave = createCustomerCreateDraftAutosave({
      debounceMs: CUSTOMER_CREATE_DRAFT_DEBOUNCE_MS,
      setTimeoutFn: timers.setTimeoutFn as unknown as typeof setTimeout,
      clearTimeoutFn: timers.clearTimeoutFn as unknown as typeof clearTimeout,
      onPersisted: (r) => persisted.push(r),
    });

    const form = meaningfulForm();
    autosave.setReady(true);
    autosave.schedule("user-race", form, false);

    autosave.finalizeAccepted("user-race");
    assert.equal(autosave.isWriteBlocked(), true);
    assert.equal(loadCustomerCreateDraft("user-race").ok, false);

    autosave.schedule("user-race", form, false);
    timers.advance(CUSTOMER_CREATE_DRAFT_DEBOUNCE_MS + 50);

    assert.equal(loadCustomerCreateDraft("user-race").ok, false);
    assert.equal(
      localStorage.getItem(`${CUSTOMER_CREATE_DRAFT_KEY_PREFIX}user-race`),
      null,
    );
    assert.equal(persisted.length, 0);
    autosave.dispose();
  });

  it("cancelPending prevents a queued save from writing after clear", () => {
    const timers = createFakeTimers();
    const autosave = createCustomerCreateDraftAutosave({
      debounceMs: CUSTOMER_CREATE_DRAFT_DEBOUNCE_MS,
      setTimeoutFn: timers.setTimeoutFn as unknown as typeof setTimeout,
      clearTimeoutFn: timers.clearTimeoutFn as unknown as typeof clearTimeout,
    });

    autosave.setReady(true);
    autosave.schedule("user-race", meaningfulForm(), false);
    autosave.cancelPending();
    clearCustomerCreateDraft("user-race");
    timers.advance(CUSTOMER_CREATE_DRAFT_DEBOUNCE_MS + 50);
    assert.equal(loadCustomerCreateDraft("user-race").ok, false);
    autosave.dispose();
  });

  it("finalizeAccepted is idempotent", () => {
    saveCustomerCreateDraft("user-race", meaningfulForm());
    assert.equal(loadCustomerCreateDraft("user-race").ok, true);

    const autosave = createCustomerCreateDraftAutosave();
    autosave.setReady(true);
    autosave.finalizeAccepted("user-race");
    autosave.finalizeAccepted("user-race");
    assert.equal(loadCustomerCreateDraft("user-race").ok, false);
    autosave.dispose();
  });

  it("on-hold style finalizeAccepted also blocks later schedule writes", () => {
    const timers = createFakeTimers();
    const autosave = createCustomerCreateDraftAutosave({
      debounceMs: CUSTOMER_CREATE_DRAFT_DEBOUNCE_MS,
      setTimeoutFn: timers.setTimeoutFn as unknown as typeof setTimeout,
      clearTimeoutFn: timers.clearTimeoutFn as unknown as typeof clearTimeout,
    });
    const form = meaningfulForm();
    autosave.setReady(true);
    autosave.schedule("user-race", form, false);
    autosave.finalizeAccepted("user-race");
    autosave.schedule("user-race", form, false);
    timers.advance(5000);
    assert.equal(loadCustomerCreateDraft("user-race").ok, false);
    autosave.dispose();
  });

  it("discard clears storage but allows a new draft after re-input", () => {
    const timers = createFakeTimers();
    const autosave = createCustomerCreateDraftAutosave({
      debounceMs: CUSTOMER_CREATE_DRAFT_DEBOUNCE_MS,
      setTimeoutFn: timers.setTimeoutFn as unknown as typeof setTimeout,
      clearTimeoutFn: timers.clearTimeoutFn as unknown as typeof clearTimeout,
    });
    const form = meaningfulForm();
    autosave.setReady(true);
    autosave.schedule("user-race", form, false);
    timers.advance(CUSTOMER_CREATE_DRAFT_DEBOUNCE_MS + 10);
    assert.equal(loadCustomerCreateDraft("user-race").ok, true);

    autosave.discard("user-race");
    assert.equal(loadCustomerCreateDraft("user-race").ok, false);
    assert.equal(autosave.isWriteBlocked(), false);
    assert.equal(autosave.isReady(), true);

    const next = { ...form, customerName: "After discard" };
    autosave.schedule("user-race", next, false);
    timers.advance(CUSTOMER_CREATE_DRAFT_DEBOUNCE_MS + 10);
    const loaded = loadCustomerCreateDraft("user-race");
    assert.equal(loaded.ok, true);
    if (loaded.ok) {
      assert.equal(loaded.value.form.customerName, "After discard");
    }
    autosave.dispose();
  });

  it("pending timer after discard does not rewrite old form", () => {
    const timers = createFakeTimers();
    const autosave = createCustomerCreateDraftAutosave({
      debounceMs: CUSTOMER_CREATE_DRAFT_DEBOUNCE_MS,
      setTimeoutFn: timers.setTimeoutFn as unknown as typeof setTimeout,
      clearTimeoutFn: timers.clearTimeoutFn as unknown as typeof clearTimeout,
    });
    autosave.setReady(true);
    autosave.schedule("user-race", meaningfulForm(), false);
    autosave.discard("user-race");
    timers.advance(CUSTOMER_CREATE_DRAFT_DEBOUNCE_MS + 50);
    assert.equal(loadCustomerCreateDraft("user-race").ok, false);
    autosave.dispose();
  });

  it("does not schedule while submitting; resumes after failure path", () => {
    const timers = createFakeTimers();
    const autosave = createCustomerCreateDraftAutosave({
      debounceMs: CUSTOMER_CREATE_DRAFT_DEBOUNCE_MS,
      setTimeoutFn: timers.setTimeoutFn as unknown as typeof setTimeout,
      clearTimeoutFn: timers.clearTimeoutFn as unknown as typeof clearTimeout,
    });
    const form = meaningfulForm();
    autosave.setReady(true);
    autosave.schedule("user-race", form, true);
    timers.advance(CUSTOMER_CREATE_DRAFT_DEBOUNCE_MS + 50);
    assert.equal(loadCustomerCreateDraft("user-race").ok, false);

    autosave.schedule("user-race", form, false);
    timers.advance(CUSTOMER_CREATE_DRAFT_DEBOUNCE_MS + 50);
    assert.equal(loadCustomerCreateDraft("user-race").ok, true);
    autosave.dispose();
  });

  it("dispose cancels pending timer so unmount cannot write", () => {
    const timers = createFakeTimers();
    const autosave = createCustomerCreateDraftAutosave({
      debounceMs: CUSTOMER_CREATE_DRAFT_DEBOUNCE_MS,
      setTimeoutFn: timers.setTimeoutFn as unknown as typeof setTimeout,
      clearTimeoutFn: timers.clearTimeoutFn as unknown as typeof clearTimeout,
    });
    autosave.setReady(true);
    autosave.schedule("user-race", meaningfulForm(), false);
    autosave.dispose();
    timers.advance(CUSTOMER_CREATE_DRAFT_DEBOUNCE_MS + 50);
    assert.equal(loadCustomerCreateDraft("user-race").ok, false);
  });

  it("userId change: pending timer for A does not write into B after cancel+reschedule", () => {
    const timers = createFakeTimers();
    const autosave = createCustomerCreateDraftAutosave({
      debounceMs: CUSTOMER_CREATE_DRAFT_DEBOUNCE_MS,
      setTimeoutFn: timers.setTimeoutFn as unknown as typeof setTimeout,
      clearTimeoutFn: timers.clearTimeoutFn as unknown as typeof clearTimeout,
    });
    const formA = { ...meaningfulForm(), customerName: "User A" };
    const formB = { ...meaningfulForm(), customerName: "User B" };
    autosave.setReady(true);
    autosave.schedule("user-a", formA, false);
    // Mimic React effect cleanup + userId change
    autosave.cancelPending();
    autosave.resetWriteBlock();
    autosave.schedule("user-b", formB, false);
    timers.advance(CUSTOMER_CREATE_DRAFT_DEBOUNCE_MS + 10);

    assert.equal(loadCustomerCreateDraft("user-a").ok, false);
    const loadedB = loadCustomerCreateDraft("user-b");
    assert.equal(loadedB.ok, true);
    if (loadedB.ok) {
      assert.equal(loadedB.value.form.customerName, "User B");
    }
    autosave.dispose();
  });

  it("blank form save clears existing draft without blocking later edits", () => {
    const timers = createFakeTimers();
    const autosave = createCustomerCreateDraftAutosave({
      debounceMs: CUSTOMER_CREATE_DRAFT_DEBOUNCE_MS,
      setTimeoutFn: timers.setTimeoutFn as unknown as typeof setTimeout,
      clearTimeoutFn: timers.clearTimeoutFn as unknown as typeof clearTimeout,
    });
    autosave.setReady(true);
    autosave.schedule("user-race", meaningfulForm(), false);
    timers.advance(CUSTOMER_CREATE_DRAFT_DEBOUNCE_MS + 10);
    assert.equal(loadCustomerCreateDraft("user-race").ok, true);

    autosave.schedule("user-race", createEmptyCustomerCreateFormData(), false);
    timers.advance(CUSTOMER_CREATE_DRAFT_DEBOUNCE_MS + 10);
    assert.equal(loadCustomerCreateDraft("user-race").ok, false);

    autosave.schedule("user-race", meaningfulForm(), false);
    timers.advance(CUSTOMER_CREATE_DRAFT_DEBOUNCE_MS + 10);
    assert.equal(loadCustomerCreateDraft("user-race").ok, true);
    autosave.dispose();
  });
});
