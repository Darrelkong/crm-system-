import {
  CRM_THEME_COLOR_DARK,
  CRM_THEME_COLOR_LIGHT,
} from "@/lib/theme/crm-theme-bootstrap";

export const CRM_BOOT_SPLASH_LOGO_SRC = "/icons/apple-touch-icon.png";
export const CRM_BOOT_SPLASH_FADE_MS = 200;

export const CRM_BOOT_SPLASH_LOADING_TEXT = {
  en: "Loading, please wait",
  "zh-Hant": "正在載入中，請稍候",
  "zh-Hans": "正在加载中，请稍候",
} as const;

export type CrmBootSplashLocale = keyof typeof CRM_BOOT_SPLASH_LOADING_TEXT;

export function resolveBootSplashLoadingText(
  locale: string | null | undefined,
): string {
  if (locale === "zh-Hant" || locale === "zh-Hans") {
    return CRM_BOOT_SPLASH_LOADING_TEXT[locale];
  }
  return CRM_BOOT_SPLASH_LOADING_TEXT.en;
}

export function shouldEnableBootSplash(input: {
  standalone: boolean;
  startupPreview: boolean;
  allowDevPreview: boolean;
}): boolean {
  if (input.standalone) {
    return true;
  }
  return input.allowDevPreview && input.startupPreview;
}

export function shouldCollectStartupTiming(input: {
  standalone: boolean;
  startupPreview: boolean;
  startupDebug: boolean;
  allowDevPreview: boolean;
}): boolean {
  if (input.startupDebug) {
    return true;
  }
  return shouldEnableBootSplash({
    standalone: input.standalone,
    startupPreview: input.startupPreview,
    allowDevPreview: input.allowDevPreview,
  });
}

export const CRM_BOOT_SPLASH_CRITICAL_CSS = `
#crm-boot-splash {
  display: none !important;
  position: fixed;
  inset: 0;
  z-index: 2147483000;
  align-items: center;
  justify-content: center;
  padding: max(1rem, env(safe-area-inset-top)) 1.5rem
    max(1rem, env(safe-area-inset-bottom));
  background: ${CRM_THEME_COLOR_LIGHT};
  color: #172033;
  transition: opacity ${CRM_BOOT_SPLASH_FADE_MS}ms ease-out;
}
html[data-theme="dark"] #crm-boot-splash {
  background: ${CRM_THEME_COLOR_DARK};
  color: #f5f7fa;
}
@media (display-mode: standalone) {
  #crm-boot-splash:not(.crm-boot-splash--removed):not([hidden]) {
    display: flex !important;
  }
}
html.crm-boot-splash-ios-standalone #crm-boot-splash:not(.crm-boot-splash--removed):not([hidden]) {
  display: flex !important;
}
html[data-crm-boot-preview="1"] #crm-boot-splash:not(.crm-boot-splash--removed):not([hidden]) {
  display: flex !important;
}
#crm-boot-splash.crm-boot-splash--dismissed {
  opacity: 0;
  pointer-events: none;
}
#crm-boot-splash.crm-boot-splash--removed {
  display: none !important;
}
.crm-boot-splash__inner {
  display: flex;
  width: 100%;
  max-width: 18rem;
  flex-direction: column;
  align-items: center;
  gap: 1rem;
  text-align: center;
}
.crm-boot-splash__logo {
  width: 5.5rem;
  height: 5.5rem;
  border-radius: 1.25rem;
}
.crm-boot-splash__title {
  margin: 0;
  font-size: 1.125rem;
  font-weight: 600;
  letter-spacing: 0.02em;
}
.crm-boot-splash__message {
  margin: 0;
  font-size: 0.875rem;
  color: #6b7890;
}
html[data-theme="dark"] .crm-boot-splash__message {
  color: #9aa8bc;
}
.crm-boot-splash__spinner {
  width: 1.5rem;
  height: 1.5rem;
  border: 2px solid rgba(47, 111, 179, 0.18);
  border-top-color: #2f6fb3;
  border-radius: 9999px;
  animation: crm-boot-spin 0.8s linear infinite;
}
html[data-theme="dark"] .crm-boot-splash__spinner {
  border-color: rgba(109, 96, 200, 0.22);
  border-top-color: #6d60c8;
}
@keyframes crm-boot-spin {
  to {
    transform: rotate(360deg);
  }
}
#crm-startup-debug {
  display: none;
  position: fixed;
  left: 0.75rem;
  right: 0.75rem;
  bottom: max(0.75rem, env(safe-area-inset-bottom));
  z-index: 2147483001;
  border-radius: 0.75rem;
  padding: 0.75rem 0.875rem;
  background: rgba(23, 32, 51, 0.92);
  color: #f5f7fa;
  font: 12px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace;
  white-space: pre-wrap;
}
html[data-crm-startup-debug="visible"] #crm-startup-debug {
  display: block;
}
`.trim();
