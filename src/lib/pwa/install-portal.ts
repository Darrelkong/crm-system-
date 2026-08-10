import { CRM_THEME_COLOR_LIGHT } from "@/lib/theme/crm-theme-bootstrap";

export const INSTALL_PORTAL_CRM_ENTRY_URL = "/";
export const INSTALL_PORTAL_MANIFEST_PATH = "/install/manifest.webmanifest";
export const INSTALL_PORTAL_APPLE_TOUCH_ICON = "/install/apple-touch-icon.png";
export const INSTALL_PORTAL_ICON_192 = "/install/icon-192.png";
export const INSTALL_PORTAL_ICON_512 = "/install/icon-512.png";
export const INSTALL_PORTAL_THEME_COLOR = CRM_THEME_COLOR_LIGHT;

export const INSTALL_PORTAL_MANIFEST_ID = "https://crm.echfronthk.com/";
export const INSTALL_PORTAL_MANIFEST_NAME = "ECHFRONT CRM";
export const INSTALL_PORTAL_MANIFEST_SHORT_NAME = "ECHFRONT";
export const INSTALL_PORTAL_MANIFEST_START_URL = "/";
export const INSTALL_PORTAL_MANIFEST_SCOPE = "/";
export const INSTALL_PORTAL_MANIFEST_DISPLAY = "standalone";

export type InstallPortalLocale = "en" | "zh-Hant" | "zh-Hans";

export type InstallPortalPlatform =
  | "ios"
  | "android"
  | "desktop"
  | "standalone";

export type InstallPortalDetectionInput = {
  displayModeStandalone: boolean;
  navigatorStandalone?: boolean;
  userAgent: string;
  platform: string;
  maxTouchPoints: number;
};

export const INSTALL_PORTAL_MANIFEST_DESCRIPTION =
  "ECHFRONT CRM - internal client management";

export function classifyInstallPortalPlatform(
  input: InstallPortalDetectionInput,
): InstallPortalPlatform {
  if (input.displayModeStandalone || input.navigatorStandalone === true) {
    return "standalone";
  }

  const userAgent = input.userAgent;
  if (/Android/i.test(userAgent)) {
    return "android";
  }

  if (/iPhone|iPad|iPod/i.test(userAgent)) {
    return "ios";
  }

  const isAppleDesktopUserAgent =
    /Macintosh/i.test(userAgent) || input.platform === "MacIntel";
  if (isAppleDesktopUserAgent && input.maxTouchPoints > 1) {
    return "ios";
  }

  return "desktop";
}

export function buildInstallPortalPlatformDetectorScript(): string {
  return `function detectPlatform() {
  try {
    if (window.matchMedia("(display-mode: standalone)").matches) {
      return "standalone";
    }
    if (window.navigator.standalone === true) {
      return "standalone";
    }
  } catch (e) {}
  var ua = navigator.userAgent || "";
  if (/Android/i.test(ua)) {
    return "android";
  }
  if (/iPhone|iPad|iPod/i.test(ua)) {
    return "ios";
  }
  var platform = navigator.platform || "";
  var maxTouchPoints = navigator.maxTouchPoints || 0;
  var isAppleDesktopUa = /Macintosh/i.test(ua) || platform === "MacIntel";
  if (isAppleDesktopUa && maxTouchPoints > 1) {
    return "ios";
  }
  return "desktop";
}`;
}

type InstallPortalCopy = {
  pageTitle: string;
  productName: string;
  securityNote: string;
  enterCrm: string;
  languageLabel: string;
  ios: {
    heading: string;
    description: string;
    steps: string[];
  };
  android: {
    heading: string;
    description: string;
    installButton: string;
    fallbackTitle: string;
    fallbackSteps: string[];
    enterCrmSecondary: string;
  };
  desktop: {
    heading: string;
    description: string;
    mobileHint: string;
  };
  standalone: {
    heading: string;
    description: string;
  };
};

export const INSTALL_PORTAL_COPY: Record<InstallPortalLocale, InstallPortalCopy> =
  {
    en: {
      pageTitle: "ECHFRONT CRM — Install",
      productName: "ECHFRONT CRM",
      securityNote:
        "Company security verification is still required when you enter the CRM.",
      enterCrm: "Enter CRM",
      languageLabel: "Language",
      ios: {
        heading: "Add ECHFRONT CRM to your iPhone or iPad Home Screen",
        description:
          "After installation, open CRM directly from the ECHFRONT icon on your Apple device Home Screen.",
        steps: [
          "Tap the browser Share button",
          'Choose "Add to Home Screen"',
          'Confirm the name is ECHFRONT',
          'Tap "Add"',
        ],
      },
      android: {
        heading: "Install CRM on your phone",
        description:
          "Install ECHFRONT CRM for quicker access from your Home Screen.",
        installButton: "Install ECHFRONT CRM",
        fallbackTitle: "Install from the browser menu",
        fallbackSteps: [
          "Open the browser menu",
          'Choose "Install app" or "Add to Home screen"',
        ],
        enterCrmSecondary: "Enter CRM directly",
      },
      desktop: {
        heading: "You are using a desktop browser",
        description:
          "No installation is required. You can enter the CRM securely from here.",
        mobileHint:
          "Mobile devices can add ECHFRONT CRM to the Home Screen for faster access.",
      },
      standalone: {
        heading: "ECHFRONT CRM is installed",
        description: "You are opening the app from Home Screen mode.",
      },
    },
    "zh-Hant": {
      pageTitle: "ECHFRONT CRM — 安裝",
      productName: "ECHFRONT CRM",
      securityNote: "進入系統時仍需完成公司安全身份驗證。",
      enterCrm: "進入 CRM",
      languageLabel: "語言",
      ios: {
        heading: "將 ECHFRONT CRM 加入 iPhone 或 iPad 主畫面",
        description:
          "安裝後，您可以直接從 Apple 裝置主畫面的 ECHFRONT 圖標開啟 CRM。",
        steps: [
          "點擊瀏覽器的「分享」",
          "選擇「加入主畫面」",
          "確認名稱為 ECHFRONT",
          "點擊「加入」",
        ],
      },
      android: {
        heading: "將 CRM 安裝至您的手機",
        description: "安裝 ECHFRONT CRM，以便從主畫面更快速開啟。",
        installButton: "安裝 ECHFRONT CRM",
        fallbackTitle: "透過瀏覽器選單安裝",
        fallbackSteps: [
          "打開瀏覽器選單",
          "選擇「安裝應用程式」或「新增至主畫面」",
        ],
        enterCrmSecondary: "直接進入 CRM",
      },
      desktop: {
        heading: "您正在使用電腦瀏覽器",
        description: "無需安裝，即可安全進入 CRM 系統。",
        mobileHint:
          "行動裝置可以將 ECHFRONT CRM 添加至主畫面，以便更快速開啟。",
      },
      standalone: {
        heading: "ECHFRONT CRM 已安裝",
        description: "您目前正在從主畫面應用模式開啟。",
      },
    },
    "zh-Hans": {
      pageTitle: "ECHFRONT CRM — 安装",
      productName: "ECHFRONT CRM",
      securityNote: "进入系统时仍需完成公司安全身份验证。",
      enterCrm: "进入 CRM",
      languageLabel: "语言",
      ios: {
        heading: "将 ECHFRONT CRM 添加到 iPhone 或 iPad 主屏幕",
        description:
          "安装后，您可以直接从 Apple 设备主屏幕的 ECHFRONT 图标打开 CRM。",
        steps: [
          "点击浏览器的“分享”",
          "选择“添加到主屏幕”",
          "确认名称为 ECHFRONT",
          "点击“添加”",
        ],
      },
      android: {
        heading: "将 CRM 安装到您的手机",
        description: "安装 ECHFRONT CRM，以便从主屏幕更快速打开。",
        installButton: "安装 ECHFRONT CRM",
        fallbackTitle: "通过浏览器菜单安装",
        fallbackSteps: [
          "打开浏览器菜单",
          "选择“安装应用”或“添加到主屏幕”",
        ],
        enterCrmSecondary: "直接进入 CRM",
      },
      desktop: {
        heading: "您正在使用电脑浏览器",
        description: "无需安装，即可安全进入 CRM 系统。",
        mobileHint:
          "移动设备可以将 ECHFRONT CRM 添加到主屏幕，以便更快速打开。",
      },
      standalone: {
        heading: "ECHFRONT CRM 已安装",
        description: "您目前正在从主屏幕应用模式打开。",
      },
    },
  };

export function resolveInstallPortalLocale(
  acceptLanguage: string | null | undefined,
): InstallPortalLocale {
  const value = (acceptLanguage ?? "").toLowerCase();
  if (value.includes("zh-hans") || value.includes("zh-cn")) {
    return "zh-Hans";
  }
  if (value.includes("zh-hant") || value.includes("zh-tw") || value.includes("zh-hk")) {
    return "zh-Hant";
  }
  if (value.startsWith("zh")) {
    return "zh-Hant";
  }
  if (value.startsWith("en")) {
    return "en";
  }
  return "zh-Hant";
}

export function buildInstallPortalManifest() {
  return {
    id: INSTALL_PORTAL_MANIFEST_ID,
    name: INSTALL_PORTAL_MANIFEST_NAME,
    short_name: INSTALL_PORTAL_MANIFEST_SHORT_NAME,
    description: INSTALL_PORTAL_MANIFEST_DESCRIPTION,
    start_url: INSTALL_PORTAL_MANIFEST_START_URL,
    scope: INSTALL_PORTAL_MANIFEST_SCOPE,
    display: INSTALL_PORTAL_MANIFEST_DISPLAY,
    background_color: INSTALL_PORTAL_THEME_COLOR,
    theme_color: INSTALL_PORTAL_THEME_COLOR,
    icons: [
      {
        src: INSTALL_PORTAL_ICON_192,
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: INSTALL_PORTAL_ICON_512,
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: INSTALL_PORTAL_APPLE_TOUCH_ICON,
        sizes: "180x180",
        type: "image/png",
        purpose: "any",
      },
    ],
  };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function buildInstallPortalHtml(
  initialLocale: InstallPortalLocale = "zh-Hant",
): string {
  const copyJson = JSON.stringify(INSTALL_PORTAL_COPY).replaceAll("<", "\\u003c");
  const initialLocaleJson = JSON.stringify(initialLocale);
  const crmUrl = INSTALL_PORTAL_CRM_ENTRY_URL;
  const manifestPath = INSTALL_PORTAL_MANIFEST_PATH;
  const appleTouchIcon = INSTALL_PORTAL_APPLE_TOUCH_ICON;
  const themeColor = INSTALL_PORTAL_THEME_COLOR;
  const platformDetectorScript = buildInstallPortalPlatformDetectorScript();
  const pageTitle = escapeHtml(INSTALL_PORTAL_COPY[initialLocale].pageTitle);

  return `<!DOCTYPE html>
<html lang="${initialLocale}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="robots" content="noindex, nofollow">
  <meta name="theme-color" content="${themeColor}">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-title" content="ECHFRONT">
  <title>${pageTitle}</title>
  <link rel="apple-touch-icon" href="${appleTouchIcon}">
  <link rel="manifest" href="${manifestPath}">
  <style>
    :root {
      color-scheme: light;
      --bg: ${themeColor};
      --card: #ffffff;
      --text: #172033;
      --muted: #6b7890;
      --accent: #2f6fb3;
      --accent-hover: #255a91;
      --border: #e4ebf3;
      --shadow: 0 18px 48px rgba(23, 32, 51, 0.08);
    }
    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      min-height: 100%;
      width: 100%;
      max-width: 100%;
      overflow-x: hidden;
      background: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      font-size: 16px;
      line-height: 1.5;
      -webkit-text-size-adjust: 100%;
      text-size-adjust: 100%;
    }
    body {
      display: flex;
      align-items: flex-start;
      justify-content: center;
      padding:
        max(1rem, env(safe-area-inset-top))
        max(1rem, env(safe-area-inset-left))
        max(1rem, env(safe-area-inset-bottom))
        max(1rem, env(safe-area-inset-right));
    }
    .portal {
      width: 100%;
      max-width: 24rem;
      min-width: 0;
    }
    .card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 1rem;
      box-shadow: var(--shadow);
      padding: 1.25rem 1rem 1rem;
      width: 100%;
      min-width: 0;
      overflow-wrap: anywhere;
    }
    .brand {
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
      gap: 0.875rem;
      margin-bottom: 1.5rem;
    }
    .brand img {
      width: 5.5rem;
      height: 5.5rem;
      border-radius: 1.25rem;
    }
    .brand h1 {
      margin: 0;
      font-size: 1.25rem;
      font-weight: 700;
      letter-spacing: 0.02em;
      overflow-wrap: anywhere;
    }
    .lang {
      display: flex;
      justify-content: center;
      gap: 0.5rem;
      flex-wrap: wrap;
      margin-bottom: 1.25rem;
    }
    .lang button {
      border: 1px solid var(--border);
      background: #fff;
      color: var(--muted);
      border-radius: 999px;
      padding: 0.35rem 0.8rem;
      font-size: 0.8125rem;
      cursor: pointer;
    }
    .lang button[aria-pressed="true"] {
      border-color: var(--accent);
      color: var(--accent);
      background: rgba(47, 111, 179, 0.08);
    }
    .panel {
      display: none;
    }
    .panel.is-active {
      display: block;
    }
    .panel h2 {
      margin: 0 0 0.75rem;
      font-size: 1.0625rem;
      font-weight: 600;
      overflow-wrap: anywhere;
    }
    .panel p {
      margin: 0 0 1rem;
      color: var(--muted);
      font-size: 0.9375rem;
      overflow-wrap: anywhere;
    }
    ol {
      margin: 0 0 1.25rem;
      padding-left: 1.25rem;
      color: var(--text);
    }
    ol li {
      margin: 0.4rem 0;
      overflow-wrap: anywhere;
    }
    .actions {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }
    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 100%;
      min-height: 3rem;
      border-radius: 0.875rem;
      border: none;
      font-size: 1rem;
      font-weight: 600;
      text-decoration: none;
      cursor: pointer;
      transition: background-color 0.15s ease;
    }
    .btn-primary {
      background: var(--accent);
      color: #fff;
    }
    .btn-primary:hover {
      background: var(--accent-hover);
    }
    .btn-secondary {
      background: #eef4fb;
      color: var(--accent);
    }
    .btn-secondary:hover {
      background: #e3edf8;
    }
    .btn[hidden] {
      display: none !important;
    }
    .security {
      margin-top: 1.25rem;
      padding-top: 1rem;
      border-top: 1px solid var(--border);
      color: var(--muted);
      font-size: 0.8125rem;
      text-align: center;
      overflow-wrap: anywhere;
    }
    .hint {
      margin-top: 0.75rem;
      color: var(--muted);
      font-size: 0.8125rem;
      text-align: center;
      overflow-wrap: anywhere;
    }
    @media (min-width: 40rem) {
      body {
        align-items: center;
        padding:
          max(1.5rem, env(safe-area-inset-top))
          max(1.5rem, env(safe-area-inset-left))
          max(1.5rem, env(safe-area-inset-bottom))
          max(1.5rem, env(safe-area-inset-right));
      }
      .portal {
        max-width: 34rem;
      }
      .card {
        border-radius: 1.25rem;
        padding: 2rem 2rem 1.75rem;
      }
      .brand h1 {
        font-size: 1.375rem;
      }
      .panel h2 {
        font-size: 1.125rem;
      }
      .panel p,
      .security,
      .hint {
        font-size: 0.95rem;
      }
    }
  </style>
</head>
<body>
  <main class="portal">
    <section class="card">
      <div class="brand">
        <img src="${appleTouchIcon}" alt="" width="88" height="88" decoding="sync">
        <h1 id="product-name">${escapeHtml(INSTALL_PORTAL_COPY[initialLocale].productName)}</h1>
      </div>
      <div class="lang" role="group" aria-label="${escapeHtml(INSTALL_PORTAL_COPY[initialLocale].languageLabel)}">
        <button type="button" data-lang="en" aria-pressed="false">English</button>
        <button type="button" data-lang="zh-Hant" aria-pressed="false">繁體中文</button>
        <button type="button" data-lang="zh-Hans" aria-pressed="false">简体中文</button>
      </div>
      <div id="panel-ios" class="panel" data-platform="ios">
        <h2 id="ios-heading"></h2>
        <p id="ios-description"></p>
        <ol id="ios-steps"></ol>
        <div class="actions">
          <a class="btn btn-primary" id="ios-enter" href="${crmUrl}"></a>
        </div>
      </div>
      <div id="panel-android" class="panel" data-platform="android">
        <h2 id="android-heading"></h2>
        <p id="android-description"></p>
        <div class="actions">
          <button class="btn btn-primary" id="android-install" type="button" hidden></button>
          <div id="android-fallback" hidden>
            <p id="android-fallback-title"></p>
            <ol id="android-fallback-steps"></ol>
          </div>
          <a class="btn btn-secondary" id="android-enter" href="${crmUrl}"></a>
        </div>
      </div>
      <div id="panel-desktop" class="panel" data-platform="desktop">
        <h2 id="desktop-heading"></h2>
        <p id="desktop-description"></p>
        <div class="actions">
          <a class="btn btn-primary" id="desktop-enter" href="${crmUrl}"></a>
        </div>
        <p class="hint" id="desktop-hint"></p>
      </div>
      <div id="panel-standalone" class="panel" data-platform="standalone">
        <h2 id="standalone-heading"></h2>
        <p id="standalone-description"></p>
        <div class="actions">
          <a class="btn btn-primary" id="standalone-enter" href="${crmUrl}"></a>
        </div>
      </div>
      <p class="security" id="security-note"></p>
    </section>
  </main>
  <script>
  (function () {
    var COPY = ${copyJson};
    var STORAGE_KEY = "crm-install-lang";
    var CRM_URL = ${JSON.stringify(crmUrl)};
    var currentLang = ${initialLocaleJson};

    function readStoredLang() {
      try {
        var stored = localStorage.getItem(STORAGE_KEY);
        if (stored === "en" || stored === "zh-Hant" || stored === "zh-Hans") {
          return stored;
        }
      } catch (e) {}
      return null;
    }

    function writeStoredLang(lang) {
      try {
        localStorage.setItem(STORAGE_KEY, lang);
      } catch (e) {}
    }

    ${platformDetectorScript}

    function t() {
      return COPY[currentLang] || COPY["zh-Hant"];
    }

    function setText(id, value) {
      var node = document.getElementById(id);
      if (node) {
        node.textContent = value;
      }
    }

    function renderList(id, items) {
      var node = document.getElementById(id);
      if (!node) {
        return;
      }
      node.innerHTML = "";
      for (var i = 0; i < items.length; i++) {
        var li = document.createElement("li");
        li.textContent = items[i];
        node.appendChild(li);
      }
    }

    function renderLanguageButtons() {
      var buttons = document.querySelectorAll("[data-lang]");
      for (var i = 0; i < buttons.length; i++) {
        var button = buttons[i];
        var lang = button.getAttribute("data-lang");
        button.setAttribute("aria-pressed", lang === currentLang ? "true" : "false");
      }
    }

    function renderCopy() {
      var copy = t();
      document.documentElement.lang = currentLang;
      document.title = copy.pageTitle;
      setText("product-name", copy.productName);
      setText("security-note", copy.securityNote);
      setText("ios-heading", copy.ios.heading);
      setText("ios-description", copy.ios.description);
      renderList("ios-steps", copy.ios.steps);
      setText("ios-enter", copy.enterCrm);
      setText("android-heading", copy.android.heading);
      setText("android-description", copy.android.description);
      setText("android-install", copy.android.installButton);
      setText("android-fallback-title", copy.android.fallbackTitle);
      renderList("android-fallback-steps", copy.android.fallbackSteps);
      setText("android-enter", copy.android.enterCrmSecondary);
      setText("desktop-heading", copy.desktop.heading);
      setText("desktop-description", copy.desktop.description);
      setText("desktop-enter", copy.enterCrm);
      setText("desktop-hint", copy.desktop.mobileHint);
      setText("standalone-heading", copy.standalone.heading);
      setText("standalone-description", copy.standalone.description);
      setText("standalone-enter", copy.enterCrm);
      renderLanguageButtons();
    }

    function showPlatform(platform) {
      var panels = document.querySelectorAll(".panel");
      for (var i = 0; i < panels.length; i++) {
        panels[i].classList.toggle(
          "is-active",
          panels[i].getAttribute("data-platform") === platform,
        );
      }
    }

    var deferredPrompt = null;
    var installButton = document.getElementById("android-install");
    var fallback = document.getElementById("android-fallback");

    function showAndroidInstallButton() {
      if (!installButton || !deferredPrompt) {
        return;
      }
      installButton.hidden = false;
      if (fallback) {
        fallback.hidden = true;
      }
    }

    function showAndroidFallback() {
      if (!fallback) {
        return;
      }
      if (!deferredPrompt) {
        fallback.hidden = false;
      }
    }

    window.addEventListener("beforeinstallprompt", function (event) {
      event.preventDefault();
      deferredPrompt = event;
      showAndroidInstallButton();
    });

    if (installButton) {
      installButton.addEventListener("click", function () {
        if (!deferredPrompt) {
          return;
        }
        deferredPrompt.prompt();
        deferredPrompt.userChoice.finally(function () {
          deferredPrompt = null;
          installButton.hidden = true;
          showAndroidFallback();
        });
      });
    }

    var storedLang = readStoredLang();
    if (storedLang) {
      currentLang = storedLang;
    }

    var buttons = document.querySelectorAll("[data-lang]");
    for (var j = 0; j < buttons.length; j++) {
      buttons[j].addEventListener("click", function (event) {
        var lang = event.currentTarget.getAttribute("data-lang");
        if (lang === "en" || lang === "zh-Hant" || lang === "zh-Hans") {
          currentLang = lang;
          writeStoredLang(lang);
          renderCopy();
        }
      });
    }

    renderCopy();
    showPlatform(detectPlatform());
    if (detectPlatform() === "android") {
      window.setTimeout(showAndroidFallback, 0);
    }
  })();
  </script>
</body>
</html>`;
}
