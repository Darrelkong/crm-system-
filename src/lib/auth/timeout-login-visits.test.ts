import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { isTimeoutLoginReason } from "@/lib/auth/timeout-login-visits";

describe("timeout login visits", () => {
  it("detects timeout login reasons", () => {
    assert.equal(isTimeoutLoginReason("timeout", null), true);
    assert.equal(isTimeoutLoginReason(null, "idle"), true);
    assert.equal(isTimeoutLoginReason("timeout", "idle"), true);
    assert.equal(isTimeoutLoginReason(null, "revoked"), false);
    assert.equal(isTimeoutLoginReason(null, null), false);
  });

  it("uses concise informational CRM timeout copy without changing Access expiry UX", () => {
    const loginForm = readFileSync(
      new URL("../../app/(auth)/login/login-form.tsx", import.meta.url),
      "utf8",
    );
    const loginStyles = readFileSync(
      new URL("../../app/(auth)/login/login-page.css", import.meta.url),
      "utf8",
    );
    const traditionalChinese = readFileSync(
      new URL("../../i18n/locales/zh-Hant.ts", import.meta.url),
      "utf8",
    );
    const accessGate = readFileSync(
      new URL("../../components/auth/access-expired-gate.tsx", import.meta.url),
      "utf8",
    );
    const loginPage = readFileSync(
      new URL("../../app/(auth)/login/page.tsx", import.meta.url),
      "utf8",
    );
    const logoutRoute = readFileSync(
      new URL("../../app/api/auth/logout/route.ts", import.meta.url),
      "utf8",
    );

    assert.match(loginForm, /isTimeoutVisit \?\s*\(/);
    assert.match(loginForm, /className="login-page__timeout-card"/);
    assert.match(loginForm, /className="login-page__timeout-title"/);
    assert.match(loginForm, /className="login-page__timeout-body"/);
    assert.match(loginForm, /security\.crmSessionTimeoutTitle/);
    assert.doesNotMatch(
      loginForm,
      /<svg|login-page__timeout-icon|login-page__timeout-content|alert-info|login-page__notice-hint|timeoutReverifyHint/,
    );
    assert.match(loginForm, /import "\.\/login-page\.css";/);

    const timeoutCardCss = loginStyles.match(
      /\.login-page__timeout-card\s*\{([\s\S]*?)\}/,
    )?.[1];
    assert.ok(timeoutCardCss);
    assert.match(timeoutCardCss, /display:\s*block/);
    assert.match(timeoutCardCss, /width:\s*100%/);
    assert.match(timeoutCardCss, /box-sizing:\s*border-box/);
    assert.match(timeoutCardCss, /padding:\s*12px 14px/);
    assert.match(timeoutCardCss, /margin-top:\s*18px/);
    assert.match(timeoutCardCss, /margin-bottom:\s*14px/);
    assert.match(timeoutCardCss, /border-radius:\s*10px/);
    assert.match(timeoutCardCss, /background:\s*#f5f8fb/);
    assert.match(timeoutCardCss, /border:\s*1px solid #e1e8ef/);
    assert.doesNotMatch(
      loginStyles,
      /login-page__timeout-icon|login-page__timeout-card[^}]*background:\s*transparent|login-page__timeout-card[^}]*border:\s*none/,
    );
    assert.doesNotMatch(loginStyles, /alert-info/);
    assert.match(loginStyles, /\.login-page--dark \.login-page__timeout-card/);
    assert.match(traditionalChinese, /crmSessionTimeoutTitle: "登入已逾時"/);
    assert.match(
      traditionalChinese,
      /CRM 登入狀態已失效，ACC 驗證仍有效。請重新登入。/,
    );
    assert.match(accessGate, /security\.accessExpiredTitle/);
    assert.match(accessGate, /security\.verifyAccessAgain/);
    assert.match(loginPage, /isCrmTimeout/);
    assert.match(loginPage, /!isCrmTimeout && shouldRequireCloudflareAccess/);
    assert.match(logoutRoute, /reason === "idle"/);
    assert.match(logoutRoute, /\/login\?reason=timeout/);
    assert.match(logoutRoute, /getPostLogoutRedirectPath/);
  });
});
