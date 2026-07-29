import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  FOLLOW_UPS_RETURN_HISTORY_MARKER_KEY,
  FOLLOW_UPS_RETURN_STATE_VERSION,
  FOLLOW_UPS_RETURN_TTL_MS,
  buildFollowUpsReturnStorageKey,
  clampScrollY,
  getReturnMarkerFromHistoryState,
  isFollowUpsReturnStateExpired,
  mergeHistoryStateWithReturnMarker,
  normalizeFollowUpsListUrl,
  shouldSaveFollowUpsReturnOnNavigationClick,
  stripReturnMarkerFromHistoryState,
  validateFollowUpsReturnState,
  type FollowUpsReturnState,
} from "./list-return-state";

describe("follow-ups list return state helper", () => {
  it("builds storage keys isolated by full pathname+search", () => {
    const a = normalizeFollowUpsListUrl("/follow-ups", "?q=a&channel=phone");
    const b = normalizeFollowUpsListUrl("/follow-ups", "?q=b&channel=phone");
    const sameA = normalizeFollowUpsListUrl("/follow-ups", "q=a&channel=phone");
    assert.equal(a, "/follow-ups?q=a&channel=phone");
    assert.equal(
      buildFollowUpsReturnStorageKey(a),
      buildFollowUpsReturnStorageKey(sameA),
    );
    assert.notEqual(
      buildFollowUpsReturnStorageKey(a),
      buildFollowUpsReturnStorageKey(b),
    );
  });

  it("validate rejects bad schema / url / scroll / version", () => {
    const url = "/follow-ups?q=x";
    const ok: FollowUpsReturnState = {
      v: FOLLOW_UPS_RETURN_STATE_VERSION,
      url,
      scrollY: 120,
      itemId: "fu-1",
      itemViewportOffset: 40,
      savedAt: Date.now(),
    };
    assert.deepEqual(validateFollowUpsReturnState(ok, url), ok);
    assert.equal(validateFollowUpsReturnState(null, url), null);
    assert.equal(
      validateFollowUpsReturnState({ ...ok, v: 2 }, url),
      null,
    );
    assert.equal(
      validateFollowUpsReturnState({ ...ok, url: "/follow-ups?q=y" }, url),
      null,
    );
    assert.equal(
      validateFollowUpsReturnState({ ...ok, scrollY: Number.NaN }, url),
      null,
    );
    assert.equal(
      validateFollowUpsReturnState({ ...ok, scrollY: -1 }, url),
      null,
    );
  });

  it("TTL expiry is detected", () => {
    const state: FollowUpsReturnState = {
      v: 1,
      url: "/follow-ups",
      scrollY: 10,
      savedAt: Date.now() - FOLLOW_UPS_RETURN_TTL_MS - 1,
    };
    assert.equal(isFollowUpsReturnStateExpired(state), true);
    assert.equal(
      validateFollowUpsReturnState(state, "/follow-ups"),
      null,
    );
  });

  it("does not accept PII-looking extra fields into validated state", () => {
    const url = "/follow-ups";
    const validated = validateFollowUpsReturnState(
      {
        v: 1,
        url,
        scrollY: 8,
        savedAt: Date.now(),
        customerName: "秘密姓名",
        summary: "跟进摘要不应保存",
        phone: "123",
      },
      url,
    );
    assert.ok(validated);
    assert.equal(
      Object.prototype.hasOwnProperty.call(validated, "customerName"),
      false,
    );
    assert.equal(
      Object.prototype.hasOwnProperty.call(validated, "summary"),
      false,
    );
    assert.equal(
      Object.prototype.hasOwnProperty.call(validated, "phone"),
      false,
    );
  });

  it("clamps scrollY", () => {
    assert.equal(clampScrollY(-10, 500), 0);
    assert.equal(clampScrollY(100, 500), 100);
    assert.equal(clampScrollY(9999, 500), 500);
    assert.equal(clampScrollY(10, 0), 0);
  });

  it("merges and strips history marker without dropping Next fields", () => {
    const existing = { __NA: true, idx: 3, key: "abc" };
    const key = buildFollowUpsReturnStorageKey("/follow-ups?q=1");
    const merged = mergeHistoryStateWithReturnMarker(existing, key);
    assert.equal(merged.__NA, true);
    assert.equal(merged.idx, 3);
    assert.equal(merged.key, "abc");
    assert.equal(merged[FOLLOW_UPS_RETURN_HISTORY_MARKER_KEY], key);
    assert.equal(getReturnMarkerFromHistoryState(merged), key);

    const stripped = stripReturnMarkerFromHistoryState(merged);
    assert.ok(stripped);
    assert.equal(stripped.__NA, true);
    assert.equal(stripped.idx, 3);
    assert.equal(
      Object.prototype.hasOwnProperty.call(
        stripped,
        FOLLOW_UPS_RETURN_HISTORY_MARKER_KEY,
      ),
      false,
    );
  });

  it("shouldSaveFollowUpsReturnOnNavigationClick gates modifiers", () => {
    const base = {
      defaultPrevented: false,
      button: 0,
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
    };
    assert.equal(shouldSaveFollowUpsReturnOnNavigationClick(base), true);
    assert.equal(
      shouldSaveFollowUpsReturnOnNavigationClick({
        ...base,
        ctrlKey: true,
      }),
      false,
    );
    assert.equal(
      shouldSaveFollowUpsReturnOnNavigationClick({
        ...base,
        metaKey: true,
      }),
      false,
    );
    assert.equal(
      shouldSaveFollowUpsReturnOnNavigationClick({
        ...base,
        shiftKey: true,
      }),
      false,
    );
    assert.equal(
      shouldSaveFollowUpsReturnOnNavigationClick({
        ...base,
        altKey: true,
      }),
      false,
    );
    assert.equal(
      shouldSaveFollowUpsReturnOnNavigationClick({
        ...base,
        button: 1,
      }),
      false,
    );
    assert.equal(
      shouldSaveFollowUpsReturnOnNavigationClick({
        ...base,
        defaultPrevented: true,
      }),
      false,
    );
    assert.equal(
      shouldSaveFollowUpsReturnOnNavigationClick(base, { target: "_blank" }),
      false,
    );
    // Keyboard activation uses button 0.
    assert.equal(shouldSaveFollowUpsReturnOnNavigationClick(base), true);
  });
});
