import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_FOLLOW_UP_LIST_FILTERS,
  FOLLOW_UP_LIST_FILTER_KEYS,
  FOLLOW_UP_LIST_SEARCH_MAX_LENGTH,
  applyFollowUpListFiltersToSearchParams,
  buildFollowUpListHref,
  clearFollowUpListFilterParams,
  followUpListFiltersEqual,
  countActiveFollowUpListFilters,
  hasActiveFollowUpListFilters,
  normalizeFollowUpListSearch,
  parseFollowUpListFilters,
  type FollowUpListFilters,
} from "./list-filters";

describe("follow-up list filters", () => {
  it("empty URL → default filters", () => {
    assert.deepEqual(
      parseFollowUpListFilters(new URLSearchParams()),
      DEFAULT_FOLLOW_UP_LIST_FILTERS,
    );
    assert.equal(hasActiveFollowUpListFilters(DEFAULT_FOLLOW_UP_LIST_FILTERS), false);
  });

  it("parses valid combined query", () => {
    const params = new URLSearchParams(
      "q=Alice&channel=phone&from=2026-01-01&to=2026-01-31&staff=user_1",
    );
    assert.deepEqual(parseFollowUpListFilters(params), {
      search: "Alice",
      channel: "phone",
      fromDate: "2026-01-01",
      toDate: "2026-01-31",
      staffUserId: "user_1",
      validOnly: false,
    });
  });

  it("parses valid-only filter", () => {
    const params = new URLSearchParams("valid=1&from=2026-08-08&to=2026-08-08");
    assert.deepEqual(parseFollowUpListFilters(params), {
      ...DEFAULT_FOLLOW_UP_LIST_FILTERS,
      fromDate: "2026-08-08",
      toDate: "2026-08-08",
      validOnly: true,
    });
  });

  it("ignores invalid channel / date / staff", () => {
    const params = new URLSearchParams(
      "channel=bad channel!&from=01-01-2026&to=not-a-date&staff=bad id&q=ok",
    );
    assert.deepEqual(parseFollowUpListFilters(params), {
      ...DEFAULT_FOLLOW_UP_LIST_FILTERS,
      search: "ok",
    });
  });

  it("trims search and caps length", () => {
    assert.equal(normalizeFollowUpListSearch("  hello  "), "hello");
    const long = "x".repeat(FOLLOW_UP_LIST_SEARCH_MAX_LENGTH + 40);
    assert.equal(
      normalizeFollowUpListSearch(long).length,
      FOLLOW_UP_LIST_SEARCH_MAX_LENGTH,
    );
    const params = new URLSearchParams(`q=${"  ab  "}`);
    assert.equal(parseFollowUpListFilters(params).search, "ab");
  });

  it("does not write default values to URL", () => {
    const existing = new URLSearchParams("lang=zh-Hant&tab=extra");
    const next = applyFollowUpListFiltersToSearchParams(
      DEFAULT_FOLLOW_UP_LIST_FILTERS,
      existing,
    );
    assert.equal(next.get("lang"), "zh-Hant");
    assert.equal(next.get("tab"), "extra");
    for (const key of FOLLOW_UP_LIST_FILTER_KEYS) {
      assert.equal(next.has(key), false);
    }
  });

  it("serialize / parse round trip", () => {
    const filters: FollowUpListFilters = {
      search: "張三",
      channel: "wechat",
      fromDate: "2026-07-01",
      toDate: "2026-07-20",
      staffUserId: "abc-123",
      validOnly: false,
    };
    const params = applyFollowUpListFiltersToSearchParams(
      filters,
      new URLSearchParams("keep=1"),
    );
    assert.equal(params.get("keep"), "1");
    assert.deepEqual(parseFollowUpListFilters(params), filters);
  });

  it("clear filters preserves unrelated query params", () => {
    const existing = new URLSearchParams(
      "q=x&channel=phone&from=2026-01-01&to=2026-01-02&staff=u1&locale=en&foo=bar",
    );
    const cleared = clearFollowUpListFilterParams(existing);
    assert.equal(cleared.get("locale"), "en");
    assert.equal(cleared.get("foo"), "bar");
    for (const key of FOLLOW_UP_LIST_FILTER_KEYS) {
      assert.equal(cleared.has(key), false);
    }
  });

  it("URL stores stable codes, not translated labels", () => {
    const params = applyFollowUpListFiltersToSearchParams(
      {
        ...DEFAULT_FOLLOW_UP_LIST_FILTERS,
        channel: "phone",
      },
      new URLSearchParams(),
    );
    assert.equal(params.get("channel"), "phone");
    assert.notEqual(params.get("channel"), "電話");
    assert.notEqual(params.get("channel"), "电话");
  });

  it("hasActiveFollowUpListFilters detects any field", () => {
    assert.equal(
      hasActiveFollowUpListFilters({
        ...DEFAULT_FOLLOW_UP_LIST_FILTERS,
        fromDate: "2026-01-01",
      }),
      true,
    );
  });

  it("countActiveFollowUpListFilters matches active fields", () => {
    assert.equal(
      countActiveFollowUpListFilters(DEFAULT_FOLLOW_UP_LIST_FILTERS),
      0,
    );
    assert.equal(
      countActiveFollowUpListFilters({
        search: "a",
        channel: "phone",
        fromDate: "2026-01-01",
        toDate: "2026-01-31",
        staffUserId: "u1",
        validOnly: false,
      }),
      5,
    );
    assert.equal(
      countActiveFollowUpListFilters({
        ...DEFAULT_FOLLOW_UP_LIST_FILTERS,
        search: "x",
        toDate: "2026-02-01",
      }),
      2,
    );
  });

  it("followUpListFiltersEqual and buildFollowUpListHref", () => {
    const a = { ...DEFAULT_FOLLOW_UP_LIST_FILTERS, search: "a" };
    const b = { ...DEFAULT_FOLLOW_UP_LIST_FILTERS, search: "a" };
    const c = { ...DEFAULT_FOLLOW_UP_LIST_FILTERS, search: "b" };
    assert.equal(followUpListFiltersEqual(a, b), true);
    assert.equal(followUpListFiltersEqual(a, c), false);
    assert.equal(
      buildFollowUpListHref("/follow-ups", a, "locale=en"),
      "/follow-ups?locale=en&q=a",
    );
    assert.equal(
      buildFollowUpListHref("/follow-ups", DEFAULT_FOLLOW_UP_LIST_FILTERS, ""),
      "/follow-ups",
    );
  });

  it("ignores oversized / malicious query without throwing", () => {
    const params = new URLSearchParams();
    params.set("q", "x".repeat(10_000));
    params.set("channel", "<script>alert(1)</script>");
    params.set("staff", "../../etc/passwd");
    params.set("from", "9999-99-99");
    const parsed = parseFollowUpListFilters(params);
    assert.equal(parsed.search.length, FOLLOW_UP_LIST_SEARCH_MAX_LENGTH);
    assert.equal(parsed.channel, "");
    assert.equal(parsed.staffUserId, "");
    assert.equal(parsed.fromDate, "");
  });
});
