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

  it("renders the footer outside the login card without altering page layout", () => {
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
    assert.doesNotMatch(loginForm, /login-page__body/);
    assert.match(footerComponent, /data-login-copyright-footer="true"/);
    assert.doesNotMatch(
      loginForm.slice(loginForm.indexOf("<Card"), cardClose),
      /LoginCopyrightFooter/,
    );
    assert.match(loginForm, /<div className="login-page__stack">/);
  });

  it("uses fixed footer positioning independent of login layout", () => {
    const css = readFileSync(
      join(root, "src/app/(auth)/login/login-page.css"),
      "utf8",
    );
    const layoutCss = css.slice(0, css.indexOf(".login-page__copyright"));
    const copyrightBlock = css.slice(
      css.indexOf(".login-page__copyright"),
      css.length,
    );

    assert.doesNotMatch(layoutCss, /login-page__body/);
    assert.doesNotMatch(layoutCss, /flex-direction:\s*column/);
    assert.match(layoutCss, /\.login-page \{[\s\S]*align-items:\s*center/);
    assert.match(layoutCss, /\.login-page \{[\s\S]*justify-content:\s*center/);
    assert.match(copyrightBlock, /position:\s*fixed/);
    assert.match(copyrightBlock, /left:\s*0/);
    assert.match(copyrightBlock, /right:\s*0/);
    assert.match(copyrightBlock, /bottom:\s*calc\(18px \+ env\(safe-area-inset-bottom\)\)/);
    assert.match(copyrightBlock, /text-align:\s*center/);
    assert.match(copyrightBlock, /pointer-events:\s*none/);
    assert.match(copyrightBlock, /font-size:\s*12px/);
    assert.match(copyrightBlock, /font-weight:\s*400/);
    assert.doesNotMatch(css, /\.login-page__body/);
    assert.match(css, /\.login-page\s*\{[\s\S]*align-items:\s*center/);
    assert.match(css, /\.login-page\s*\{[\s\S]*justify-content:\s*center/);
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
