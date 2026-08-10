import { DEFAULT_LOCALE } from "@/i18n/config";
import {
  CRM_BOOT_SPLASH_CRITICAL_CSS,
  CRM_BOOT_SPLASH_LOGO_SRC,
  resolveBootSplashLoadingText,
} from "@/lib/pwa/boot-splash";

export function CrmBootSplashShell() {
  const loadingText = resolveBootSplashLoadingText(DEFAULT_LOCALE);

  return (
    <>
      <div
        id="crm-boot-splash"
        aria-live="polite"
        aria-busy="true"
        hidden
      >
        <div className="crm-boot-splash__inner">
          {/* Boot splash must paint from first HTML without waiting on Next/Image. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={CRM_BOOT_SPLASH_LOGO_SRC}
            alt=""
            className="crm-boot-splash__logo"
            width={88}
            height={88}
            decoding="sync"
          />
          <p className="crm-boot-splash__title">ECHFRONT CRM</p>
          <p className="crm-boot-splash__message" id="crm-boot-splash-message">
            {loadingText}
          </p>
          <div className="crm-boot-splash__spinner" aria-hidden="true" />
        </div>
      </div>
      <pre id="crm-startup-debug" aria-hidden="true" />
    </>
  );
}

export { CRM_BOOT_SPLASH_CRITICAL_CSS };
