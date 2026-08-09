import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isIosSafariBrowser,
  isStandaloneDisplayMode,
  shouldShowHomeScreenInstallGuide,
} from "./standalone";

const IPHONE_SAFARI_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const DESKTOP_CHROME_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

describe("standalone detection", () => {
  it("detects display-mode standalone", () => {
    assert.equal(
      isStandaloneDisplayMode({
        displayModeStandalone: true,
        navigatorStandalone: false,
      }),
      true,
    );
  });

  it("detects iOS navigator.standalone", () => {
    assert.equal(
      isStandaloneDisplayMode({
        displayModeStandalone: false,
        navigatorStandalone: true,
      }),
      true,
    );
  });

  it("returns false in regular browser mode", () => {
    assert.equal(
      isStandaloneDisplayMode({
        displayModeStandalone: false,
        navigatorStandalone: false,
      }),
      false,
    );
  });
});

describe("install guidance visibility", () => {
  it("shows on iPhone Safari when not standalone", () => {
    assert.equal(
      shouldShowHomeScreenInstallGuide({
        isStandalone: false,
        userAgent: IPHONE_SAFARI_UA,
      }),
      true,
    );
  });

  it("hides when already standalone", () => {
    assert.equal(
      shouldShowHomeScreenInstallGuide({
        isStandalone: true,
        userAgent: IPHONE_SAFARI_UA,
      }),
      false,
    );
  });

  it("hides on desktop browsers", () => {
    assert.equal(
      shouldShowHomeScreenInstallGuide({
        isStandalone: false,
        userAgent: DESKTOP_CHROME_UA,
      }),
      false,
    );
  });
});

describe("ios safari detection", () => {
  it("recognizes iPhone Safari user agent", () => {
    assert.equal(isIosSafariBrowser(IPHONE_SAFARI_UA), true);
  });

  it("rejects desktop Chrome user agent", () => {
    assert.equal(isIosSafariBrowser(DESKTOP_CHROME_UA), false);
  });
});
