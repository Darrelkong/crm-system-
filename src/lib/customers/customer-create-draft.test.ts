import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import {
  CUSTOMER_CREATE_DRAFT_TTL_MS,
  CUSTOMER_CREATE_DRAFT_VERSION,
  buildCustomerCreateDraftPayload,
  clearAllCustomerCreateDraftsForUser,
  clearCustomerCreateDraft,
  clearCustomerCreateDraftForLastUser,
  createEmptyCustomerCreateFormData,
  formatDraftSavedClock,
  getCustomerCreateDraftScopeIdentity,
  isCustomerCreateDraftMeaningful,
  loadCustomerCreateDraft,
  parseCustomerCreateDraftPayload,
  resolveCustomerCreateDraftScope,
  saveCustomerCreateDraft,
} from "./customer-create-draft";

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

class ThrowingStorage extends MemoryStorage {
  override getItem(): string | null {
    throw new Error("denied");
  }

  override setItem(): void {
    throw new Error("denied");
  }

  override removeItem(): void {
    throw new Error("denied");
  }
}

describe("customer-create-draft", () => {
  let previous: Storage | undefined;

  beforeEach(() => {
    previous = globalThis.localStorage;
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: new MemoryStorage(),
    });
  });

  afterEach(() => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: previous,
    });
  });

  it("saves and loads a draft for the same userId", () => {
    const form = createEmptyCustomerCreateFormData();
    form.customerName = "測試客戶";
    form.notes = "需求說明足夠十個字以上內容";
    form.salesStage = "contacted";

    const saved = saveCustomerCreateDraft("user-a", form, 1_000);
    assert.equal(saved.ok, true);

    const loaded = loadCustomerCreateDraft("user-a", 1_000);
    assert.equal(loaded.ok, true);
    if (!loaded.ok) return;
    assert.equal(loaded.value.userId, "user-a");
    assert.equal(loaded.value.form.customerName, "測試客戶");
    assert.equal(loaded.value.form.salesStage, "contacted");
    assert.equal(loaded.value.version, CUSTOMER_CREATE_DRAFT_VERSION);
  });

  it("isolates drafts by userId", () => {
    const formA = createEmptyCustomerCreateFormData();
    formA.customerName = "A";
    const formB = createEmptyCustomerCreateFormData();
    formB.customerName = "B";

    saveCustomerCreateDraft("user-a", formA, 1_000);
    saveCustomerCreateDraft("user-b", formB, 1_000);

    const a = loadCustomerCreateDraft("user-a", 1_000);
    const b = loadCustomerCreateDraft("user-b", 1_000);
    assert.equal(a.ok && a.value.form.customerName, "A");
    assert.equal(b.ok && b.value.form.customerName, "B");
  });

  it("keeps drafts within TTL", () => {
    const form = createEmptyCustomerCreateFormData();
    form.customerName = "有效";
    saveCustomerCreateDraft("user-a", form, 10_000);

    const loaded = loadCustomerCreateDraft(
      "user-a",
      10_000 + CUSTOMER_CREATE_DRAFT_TTL_MS - 1,
    );
    assert.equal(loaded.ok, true);
  });

  it("expires and clears drafts older than 72 hours", () => {
    const form = createEmptyCustomerCreateFormData();
    form.customerName = "過期";
    saveCustomerCreateDraft("user-a", form, 10_000);

    const loaded = loadCustomerCreateDraft(
      "user-a",
      10_000 + CUSTOMER_CREATE_DRAFT_TTL_MS + 1,
    );
    assert.equal(loaded.ok, false);
    if (loaded.ok) return;
    assert.equal(loaded.reason, "expired");

    const again = loadCustomerCreateDraft("user-a", 10_000);
    assert.equal(again.ok, false);
    if (!again.ok) assert.equal(again.reason, "missing");
  });

  it("rejects invalid JSON without throwing", () => {
    localStorage.setItem(
      "crm:customer-create-draft:v1:user-a",
      "{not-json",
    );
    const loaded = loadCustomerCreateDraft("user-a", 1_000);
    assert.equal(loaded.ok, false);
    if (!loaded.ok) assert.equal(loaded.reason, "invalid");
  });

  it("rejects incompatible version", () => {
    const payload = buildCustomerCreateDraftPayload(
      "user-a",
      createEmptyCustomerCreateFormData(),
      1_000,
    );
    localStorage.setItem(
      "crm:customer-create-draft:v1:user-a",
      JSON.stringify({ ...payload, version: 999 }),
    );
    const loaded = loadCustomerCreateDraft("user-a", 1_000);
    assert.equal(loaded.ok, false);
    if (!loaded.ok) assert.equal(loaded.reason, "invalid");
  });

  it("handles localStorage throw without blocking", () => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: new ThrowingStorage(),
    });
    const form = {
      ...createEmptyCustomerCreateFormData(),
      customerName: "有內容",
    };
    const saved = saveCustomerCreateDraft("user-a", form, 1_000);
    assert.equal(saved.ok, false);
    if (!saved.ok) assert.equal(saved.reason, "unavailable");

    const loaded = loadCustomerCreateDraft("user-a", 1_000);
    assert.equal(loaded.ok, false);
    if (!loaded.ok) assert.equal(loaded.reason, "unavailable");

    assert.doesNotThrow(() => clearCustomerCreateDraft("user-a"));
  });

  it("clear only removes the specified userId", () => {
    saveCustomerCreateDraft(
      "user-a",
      { ...createEmptyCustomerCreateFormData(), customerName: "A" },
      1_000,
    );
    saveCustomerCreateDraft(
      "user-b",
      { ...createEmptyCustomerCreateFormData(), customerName: "B" },
      1_000,
    );
    clearCustomerCreateDraft("user-a");
    assert.equal(loadCustomerCreateDraft("user-a", 1_000).ok, false);
    const b = loadCustomerCreateDraft("user-b", 1_000);
    assert.equal(b.ok && b.value.form.customerName, "B");
  });

  it("does not persist token or session fields in payload", () => {
    const form = createEmptyCustomerCreateFormData();
    const payload = buildCustomerCreateDraftPayload("user-a", form, 1_000);
    const json = JSON.stringify(payload);
    assert.equal(json.includes("token"), false);
    assert.equal(json.includes("session"), false);
    assert.equal(json.includes("cookie"), false);
    assert.deepEqual(Object.keys(payload).sort(), [
      "form",
      "savedAt",
      "userId",
      "version",
    ]);
  });

  it("parse rejects mismatched userId", () => {
    const payload = buildCustomerCreateDraftPayload(
      "user-a",
      createEmptyCustomerCreateFormData(),
      1_000,
    );
    const parsed = parseCustomerCreateDraftPayload(payload, "user-b", 1_000);
    assert.equal(parsed.ok, false);
  });

  it("clearCustomerCreateDraftForLastUser clears standard and family drafts for last saver only", () => {
    saveCustomerCreateDraft(
      "user-a",
      { ...createEmptyCustomerCreateFormData(), customerName: "A standard" },
      1_000,
    );
    saveCustomerCreateDraft(
      "user-a",
      { ...createEmptyCustomerCreateFormData(), customerName: "A family 1" },
      1_100,
      { kind: "family", sourceCustomerId: "source-1" },
    );
    saveCustomerCreateDraft(
      "user-a",
      { ...createEmptyCustomerCreateFormData(), customerName: "A family 2" },
      1_200,
      { kind: "family", sourceCustomerId: "source-2" },
    );
    saveCustomerCreateDraft(
      "user-b",
      { ...createEmptyCustomerCreateFormData(), customerName: "B standard" },
      2_000,
    );
    saveCustomerCreateDraft(
      "user-b",
      { ...createEmptyCustomerCreateFormData(), customerName: "B family" },
      2_100,
      { kind: "family", sourceCustomerId: "source-b" },
    );
    localStorage.setItem("unrelated:key", "keep");

    clearCustomerCreateDraftForLastUser();

    assert.equal(loadCustomerCreateDraft("user-b", 2_200).ok, false);
    assert.equal(
      loadCustomerCreateDraft("user-b", 2_200, {
        kind: "family",
        sourceCustomerId: "source-b",
      }).ok,
      false,
    );
    const aStandard = loadCustomerCreateDraft("user-a", 2_200);
    assert.equal(aStandard.ok && aStandard.value.form.customerName, "A standard");
    assert.equal(
      loadCustomerCreateDraft("user-a", 2_200, {
        kind: "family",
        sourceCustomerId: "source-1",
      }).ok,
      true,
    );
    assert.equal(
      loadCustomerCreateDraft("user-a", 2_200, {
        kind: "family",
        sourceCustomerId: "source-2",
      }).ok,
      true,
    );
    assert.equal(localStorage.getItem("unrelated:key"), "keep");
  });

  it("isolates standard and family drafts in all directions", () => {
    const standard = { ...createEmptyCustomerCreateFormData(), customerName: "Standard" };
    const familyA = { ...createEmptyCustomerCreateFormData(), customerName: "Family A" };
    const familyB = { ...createEmptyCustomerCreateFormData(), customerName: "Family B" };

    saveCustomerCreateDraft("user-a", standard, 1_000);
    saveCustomerCreateDraft("user-a", familyA, 1_100, {
      kind: "family",
      sourceCustomerId: "source-a",
    });
    saveCustomerCreateDraft("user-a", familyB, 1_200, {
      kind: "family",
      sourceCustomerId: "source-b",
    });

    assert.equal(loadCustomerCreateDraft("user-a", 1_300).ok, true);
    const loadedStandard = loadCustomerCreateDraft("user-a", 1_300);
    assert.equal(loadedStandard.ok && loadedStandard.value.form.customerName, "Standard");

    const loadedFamilyA = loadCustomerCreateDraft("user-a", 1_300, {
      kind: "family",
      sourceCustomerId: "source-a",
    });
    assert.equal(loadedFamilyA.ok && loadedFamilyA.value.form.customerName, "Family A");

    const loadedFamilyB = loadCustomerCreateDraft("user-a", 1_300, {
      kind: "family",
      sourceCustomerId: "source-b",
    });
    assert.equal(loadedFamilyB.ok && loadedFamilyB.value.form.customerName, "Family B");
  });

  it("clearAllCustomerCreateDraftsForUser removes every scoped draft for one user", () => {
    saveCustomerCreateDraft(
      "user-a",
      { ...createEmptyCustomerCreateFormData(), customerName: "A" },
      1_000,
    );
    saveCustomerCreateDraft(
      "user-a",
      { ...createEmptyCustomerCreateFormData(), customerName: "A family" },
      1_100,
      { kind: "family", sourceCustomerId: "source-a" },
    );
    clearAllCustomerCreateDraftsForUser("user-a");
    assert.equal(loadCustomerCreateDraft("user-a", 1_200).ok, false);
    assert.equal(
      loadCustomerCreateDraft("user-a", 1_200, {
        kind: "family",
        sourceCustomerId: "source-a",
      }).ok,
      false,
    );
  });

  it("draft scope identity is stable for equivalent logical scopes", () => {
    const standard = resolveCustomerCreateDraftScope({});
    const family = resolveCustomerCreateDraftScope({
      familySourceCustomerId: "source-1",
    });
    assert.equal(getCustomerCreateDraftScopeIdentity(standard), "standard");
    assert.equal(
      getCustomerCreateDraftScopeIdentity(family),
      "family:source-1",
    );
    assert.equal(
      getCustomerCreateDraftScopeIdentity(
        resolveCustomerCreateDraftScope({ familySourceCustomerId: "source-1" }),
      ),
      getCustomerCreateDraftScopeIdentity(family),
    );
  });

  it("clearCustomerCreateDraftForLastUser clears only last saver", () => {
    saveCustomerCreateDraft(
      "user-a",
      { ...createEmptyCustomerCreateFormData(), customerName: "A" },
      1_000,
    );
    saveCustomerCreateDraft(
      "user-b",
      { ...createEmptyCustomerCreateFormData(), customerName: "B" },
      2_000,
    );
    clearCustomerCreateDraftForLastUser();
    assert.equal(loadCustomerCreateDraft("user-b", 2_000).ok, false);
    const a = loadCustomerCreateDraft("user-a", 2_000);
    assert.equal(a.ok && a.value.form.customerName, "A");
  });

  it("formats draft clock as HH:mm:ss", () => {
    const clock = formatDraftSavedClock(Date.UTC(2026, 6, 26, 4, 5, 6));
    assert.match(clock, /^\d{2}:\d{2}:\d{2}$/);
  });

  it("empty form defaults salesStage to new_lead", () => {
    assert.equal(createEmptyCustomerCreateFormData().salesStage, "new_lead");
  });

  it("treats blank default form as not meaningful", () => {
    assert.equal(
      isCustomerCreateDraftMeaningful(createEmptyCustomerCreateFormData()),
      false,
    );
    assert.equal(
      isCustomerCreateDraftMeaningful({
        ...createEmptyCustomerCreateFormData(),
        customerName: "有內容",
      }),
      true,
    );
  });

  it("clears storage when saving a blank form", () => {
    saveCustomerCreateDraft(
      "user-a",
      { ...createEmptyCustomerCreateFormData(), customerName: "暫存" },
      1_000,
    );
    const cleared = saveCustomerCreateDraft(
      "user-a",
      createEmptyCustomerCreateFormData(),
      2_000,
    );
    assert.equal(cleared.ok, true);
    if (cleared.ok) assert.equal(cleared.value, null);
    assert.equal(loadCustomerCreateDraft("user-a", 2_000).ok, false);
  });

  it("restores confirmed and pending nameStatus drafts", () => {
    saveCustomerCreateDraft(
      "user-a",
      {
        ...createEmptyCustomerCreateFormData(),
        customerName: "王小明",
        nameStatus: "confirmed",
        phone: "13800138000",
      },
      1_000,
    );
    const confirmed = loadCustomerCreateDraft("user-a", 1_000);
    assert.equal(confirmed.ok && confirmed.value.form.nameStatus, "confirmed");
    assert.equal(confirmed.ok && confirmed.value.form.customerName, "王小明");

    saveCustomerCreateDraft(
      "user-a",
      {
        ...createEmptyCustomerCreateFormData(),
        customerName: "X先生",
        nameStatus: "pending",
        phone: "13800138001",
      },
      2_000,
    );
    const pendingMr = loadCustomerCreateDraft("user-a", 2_000);
    assert.equal(pendingMr.ok && pendingMr.value.form.nameStatus, "pending");
    assert.equal(pendingMr.ok && pendingMr.value.form.customerName, "X先生");

    saveCustomerCreateDraft(
      "user-a",
      {
        ...createEmptyCustomerCreateFormData(),
        customerName: "X女士",
        nameStatus: "pending",
        phone: "13800138002",
      },
      3_000,
    );
    const pendingMs = loadCustomerCreateDraft("user-a", 3_000);
    assert.equal(pendingMs.ok && pendingMs.value.form.nameStatus, "pending");
    assert.equal(pendingMs.ok && pendingMs.value.form.customerName, "X女士");
  });

  it("legacy draft without nameStatus defaults to confirmed on load", () => {
    const legacy = {
      version: CUSTOMER_CREATE_DRAFT_VERSION,
      userId: "user-a",
      savedAt: 1_000,
      form: {
        customerName: "舊草稿",
        requestedProjectName: "項目",
        customerType: "individual",
        phoneCountryCode: "+86",
        phone: "13800138000",
        wechatId: "",
        email: "",
        source: "referral",
        sourceRemark: "",
        salesStage: "new_lead",
        notes: "備註足夠長了吧",
      },
    };
    localStorage.setItem(
      "crm:customer-create-draft:v1:user-a",
      JSON.stringify(legacy),
    );
    const loaded = loadCustomerCreateDraft("user-a", 1_000);
    assert.equal(loaded.ok, true);
    if (loaded.ok) {
      assert.equal(loaded.value.form.nameStatus, "confirmed");
      assert.equal(loaded.value.form.customerName, "舊草稿");
    }
  });
});
