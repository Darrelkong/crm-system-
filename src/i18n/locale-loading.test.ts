import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  clearLocaleMessageCache,
  getCachedMessages,
  loadMessages,
  primeLocaleMessageCache,
} from "@/i18n/load-messages";
import {
  shouldRenderTranslatedApp,
  shouldShowLocaleLoading,
} from "@/i18n/locale-catalog-state";
import en from "@/i18n/locales/en";

function mockFetch(
  handlers: Record<string, () => Promise<Response>>,
): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    const handler = handlers[url];
    if (!handler) {
      return new Response("not found", { status: 404 });
    }
    return handler();
  }) as typeof fetch;
}

describe("locale catalog state", () => {
  it("does not render translated app while loading", () => {
    assert.equal(shouldRenderTranslatedApp("loading", "en", null), false);
    assert.equal(shouldRenderTranslatedApp("ready", "en", null), false);
    assert.equal(shouldRenderTranslatedApp("ready", "zh-Hant", "en"), false);
    assert.equal(shouldRenderTranslatedApp("error", "en", "en"), false);
  });

  it("renders translated app only when loaded locale matches", () => {
    assert.equal(shouldRenderTranslatedApp("ready", "en", "en"), true);
    assert.equal(shouldRenderTranslatedApp("ready", "zh-Hans", "zh-Hans"), true);
  });

  it("shows loading while catalog is not ready for the active locale", () => {
    assert.equal(shouldShowLocaleLoading("loading", "en", null), true);
    assert.equal(shouldShowLocaleLoading("ready", "zh-Hant", "en"), true);
    assert.equal(shouldShowLocaleLoading("ready", "en", "en"), false);
  });
});

describe("loadMessages", () => {
  it("loads English catalog successfully", async () => {
    clearLocaleMessageCache();
    const messages = await loadMessages(
      "en",
      mockFetch({
        "/locales/en.json": async () =>
          Response.json({ common: { appName: "ECHFRONT CRM" } }),
      }),
    );
    assert.equal(messages.common.appName, "ECHFRONT CRM");
  });

  it("loads zh-Hans and zh-Hant catalogs successfully", async () => {
    clearLocaleMessageCache();
    const zhHans = await loadMessages(
      "zh-Hans",
      mockFetch({
        "/locales/zh-Hans.json": async () =>
          Response.json({ common: { save: "保存" } }),
      }),
    );
    const zhHant = await loadMessages(
      "zh-Hant",
      mockFetch({
        "/locales/zh-Hant.json": async () =>
          Response.json({ common: { save: "儲存" } }),
      }),
    );
    assert.equal(zhHans.common.save, "保存");
    assert.equal(zhHant.common.save, "儲存");
  });

  it("uses cache without refetching the same locale", async () => {
    clearLocaleMessageCache();
    let calls = 0;
    const fetchImpl = mockFetch({
      "/locales/en.json": async () => {
        calls += 1;
        return Response.json(en);
      },
    });

    await loadMessages("en", fetchImpl);
    await loadMessages("en", fetchImpl);
    assert.equal(calls, 1);
  });

  it("rejects fetch 404 without unhandled rejection", async () => {
    clearLocaleMessageCache();
    await assert.rejects(
      () =>
        loadMessages(
          "en",
          mockFetch({
            "/locales/en.json": async () => new Response("missing", { status: 404 }),
          }),
        ),
      /Failed to load locale: en/,
    );
  });

  it("rejects network failures without unhandled rejection", async () => {
    clearLocaleMessageCache();
    const fetchImpl = (async () => {
      throw new Error("network down");
    }) as typeof fetch;

    await assert.rejects(
      () => loadMessages("en", fetchImpl),
      /network down/,
    );
  });

  it("rejects malformed JSON", async () => {
    clearLocaleMessageCache();
    await assert.rejects(
      () =>
        loadMessages(
          "en",
          mockFetch({
            "/locales/en.json": async () =>
              new Response("not-json", {
                status: 200,
                headers: { "content-type": "application/json" },
              }),
          }),
        ),
      /Invalid locale JSON: en/,
    );
  });

  it("ignores stale responses when a newer locale request wins the race", async () => {
    clearLocaleMessageCache();
    let resolveSlow: ((value: Response) => void) | undefined;
    const slowPromise = new Promise<Response>((resolve) => {
      resolveSlow = resolve;
    });

    const fetchImpl = mockFetch({
      "/locales/en.json": async () => slowPromise,
      "/locales/zh-Hant.json": async () =>
        Response.json({ common: { appName: "繁中" } }),
    });

    const slowRequest = loadMessages("en", fetchImpl);
    const fastRequest = await loadMessages("zh-Hant", fetchImpl);
    assert.equal(fastRequest.common.appName, "繁中");

    resolveSlow?.(Response.json({ common: { appName: "English" } }));
    const slowResult = await slowRequest;
    assert.equal(slowResult.common.appName, "English");

    primeLocaleMessageCache("zh-Hant", {
      common: { appName: "繁中" },
    } as unknown as typeof en);
    assert.equal(getCachedMessages("zh-Hant")?.common.appName, "繁中");
  });
});

describe("I18nProvider loading UX", () => {
  const providerSource = readFileSync("src/i18n/provider.tsx", "utf8");
  const loadingSource = readFileSync("src/i18n/locale-loading-shell.tsx", "utf8");
  const errorSource = readFileSync("src/i18n/locale-error-shell.tsx", "utf8");

  it("does not render translated children before catalog is ready", () => {
    assert.match(providerSource, /shouldRenderTranslatedApp/);
    assert.match(providerSource, /shouldShowLocaleLoading/);
    assert.doesNotMatch(providerSource, /messages \?\? \(\{\} as Messages\)/);
    assert.match(providerSource, /<LocaleLoadingShell \/>/);
    assert.doesNotMatch(providerSource, /\{children\}[\s\S]*messages == null/);
  });

  it("shows a locale-free loading shell", () => {
    assert.match(loadingSource, /ECHFRONT CRM/);
    assert.match(loadingSource, /LoadingSpinner/);
    assert.doesNotMatch(loadingSource, /t\(/);
    assert.doesNotMatch(loadingSource, /customers\./);
  });

  it("shows a locale-free error fallback with refresh action", () => {
    assert.match(errorSource, /Unable to load interface language/);
    assert.match(errorSource, /介面語言載入失敗/);
    assert.match(errorSource, /window\.location\.reload/);
    assert.doesNotMatch(errorSource, /customers\./);
  });

  it("handles fetch rejection in provider effect", () => {
    assert.match(providerSource, /\.catch\(/);
    assert.match(providerSource, /setStatus\("error"\)/);
    assert.match(providerSource, /<LocaleErrorShell \/>/);
  });

  it("tracks loadedLocale separately from active locale", () => {
    assert.match(providerSource, /loadedLocale/);
    assert.match(providerSource, /setLoadedLocale\(targetLocale\)/);
  });

  it("cancels stale locale fetch requests on rapid locale changes", () => {
    assert.match(providerSource, /let cancelled = false/);
    assert.match(providerSource, /if \(cancelled\)/);
    assert.match(providerSource, /cancelled = true/);
  });

  it("does not import locale catalogs into the provider runtime bundle", () => {
    assert.doesNotMatch(providerSource, /import en from "\.\/locales\/en"/);
    assert.doesNotMatch(providerSource, /import zhHans from "\.\/locales\/zh-Hans"/);
    assert.doesNotMatch(providerSource, /import zhHant from "\.\/locales\/zh-Hant"/);
    assert.match(providerSource, /import type \{ Messages \} from "\.\/locales\/en"/);
  });
});
