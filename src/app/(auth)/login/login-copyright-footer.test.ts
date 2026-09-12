import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import en from "@/i18n/locales/en";
import zhHans from "@/i18n/locales/zh-Hans";
import zhHant from "@/i18n/locales/zh-Hant";

const root = process.cwd();

const COPYRIGHT_COPY = {
  "zh-Hant": "Copyright © 2026 Echfront Inc. 保留一切權利",
  "zh-Hans": "Copyright © 2026 Echfront Inc. 保留一切权利",
  en: "Copyright © 2026 Echfront Inc. All rights reserved",
} as const;

function hasTrailingPunctuation(value: string): boolean {
  return /[。.!?！？]$/.test(value.trim());
}

describe("login copyright footer", () => {
  it("uses exact Traditional Chinese copy without trailing punctuation", () => {
    assert.equal(zhHant.auth.copyrightNotice, COPYRIGHT_COPY["zh-Hant"]);
    assert.equal(hasTrailingPunctuation(zhHant.auth.copyrightNotice), false);
  });

  it("uses exact Simplified Chinese copy without trailing punctuation", () => {
    assert.equal(zhHans.auth.copyrightNotice, COPYRIGHT_COPY["zh-Hans"]);
    assert.equal(hasTrailingPunctuation(zhHans.auth.copyrightNotice), false);
  });

  it("uses exact English copy without trailing punctuation", () => {
    assert.equal(en.auth.copyrightNotice, COPYRIGHT_COPY.en);
    assert.equal(hasTrailingPunctuation(en.auth.copyrightNotice), false);
  });

  it("keeps one normal space after Echfront Inc.", () => {
    for (const value of Object.values(COPYRIGHT_COPY)) {
      assert.match(value, /Echfront Inc\. [^\s]/);
      assert.doesNotMatch(value, /Echfront Inc\. {2}/);
    }
  });

  it("renders the footer outside the login card in page flow", () => {
    const loginForm = readFileSync(
      join(root, "src/app/(auth)/login/login-form.tsx"),
      "utf8",
    );
    const footerComponent = readFileSync(
      join(root, "src/app/(auth)/login/login-copyright-footer.tsx"),
      "utf8",
    );
    const cardClose = loginForm.indexOf("</Card>");
    const footerMount = loginForm.indexOf("<LoginCopyrightFooter />");

    assert.ok(cardClose > -1);
    assert.ok(footerMount > cardClose);
    assert.match(loginForm, /login-page__body/);
    assert.match(footerComponent, /data-login-copyright-footer="true"/);
    assert.doesNotMatch(
      loginForm.slice(loginForm.indexOf("<Card"), cardClose),
      /LoginCopyrightFooter/,
    );
  });

  it("uses in-flow mobile-safe layout without fixed footer positioning", () => {
    const css = readFileSync(
      join(root, "src/app/(auth)/login/login-page.css"),
      "utf8",
    );

    assert.match(css, /\.login-page__body/);
    assert.match(css, /\.login-page__copyright/);
    assert.match(css, /font-size:\s*12px/);
    assert.match(css, /font-weight:\s*400/);
    assert.match(css, /--login-copyright/);
    assert.match(css, /calc\(18px \+ env\(safe-area-inset-bottom\)\)/);
    assert.match(css, /flex-direction:\s*column/);
    const copyrightBlock = css.slice(
      css.indexOf(".login-page__copyright"),
      css.indexOf(".login-page__scene"),
    );
    assert.doesNotMatch(copyrightBlock, /position:\s*fixed/);
    assert.doesNotMatch(copyrightBlock, /w-screen|100vw/);
  });

  it("does not change login submit endpoint or auth handling", () => {
    const loginForm = readFileSync(
      join(root, "src/app/(auth)/login/login-form.tsx"),
      "utf8",
    );

    assert.match(loginForm, /fetch\("\/api\/auth\/login"/);
    assert.match(loginForm, /handleSubmit/);
    assert.doesNotMatch(loginForm, /copyrightNotice.*fetch/);
  });
});
