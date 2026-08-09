"use client";

import { useSyncExternalStore } from "react";
import { useTranslation } from "@/i18n/provider";
import {
  detectStandaloneFromWindow,
  shouldShowHomeScreenInstallGuide,
} from "@/lib/pwa/standalone";

function getInstallGuideVisible(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  return shouldShowHomeScreenInstallGuide({
    isStandalone: detectStandaloneFromWindow(),
    userAgent: window.navigator.userAgent,
  });
}

function subscribeToInstallGuideVisibility(onStoreChange: () => void): () => void {
  const media = window.matchMedia("(display-mode: standalone)");
  media.addEventListener("change", onStoreChange);
  return () => media.removeEventListener("change", onStoreChange);
}

export function HomeScreenInstallGuide() {
  const { t } = useTranslation();
  const visible = useSyncExternalStore(
    subscribeToInstallGuideVisibility,
    getInstallGuideVisible,
    () => false,
  );

  if (!visible) {
    return null;
  }

  return (
    <section
      className="surface-card mt-4 p-5 sm:p-6"
      aria-label={t("help.sections.homeScreenApp.title")}
    >
      <h3 className="text-base font-semibold text-[#172033]">
        {t("help.sections.homeScreenApp.title")}
      </h3>
      <p className="mt-2 text-sm leading-relaxed text-[#6B7890]">
        {t("help.sections.homeScreenApp.description")}
      </p>
      <ol className="mt-4 space-y-3">
        <li className="rounded-xl border border-[#EEF3F8] bg-[#FAFBFD] px-4 py-3 text-sm leading-relaxed text-[#172033]">
          {t("help.sections.homeScreenApp.items.stepShare")}
        </li>
        <li className="rounded-xl border border-[#EEF3F8] bg-[#FAFBFD] px-4 py-3 text-sm leading-relaxed text-[#172033]">
          {t("help.sections.homeScreenApp.items.stepAddToHomeScreen")}
        </li>
        <li className="rounded-xl border border-[#EEF3F8] bg-[#FAFBFD] px-4 py-3 text-sm leading-relaxed text-[#172033]">
          {t("help.sections.homeScreenApp.items.stepOpenStandalone")}
        </li>
      </ol>
    </section>
  );
}
