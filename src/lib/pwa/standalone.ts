export type StandaloneDetectionInput = {
  displayModeStandalone: boolean;
  navigatorStandalone?: boolean;
};

export function isStandaloneDisplayMode(
  input: StandaloneDetectionInput,
): boolean {
  if (input.displayModeStandalone) {
    return true;
  }
  return input.navigatorStandalone === true;
}

export function isIosSafariBrowser(userAgent: string): boolean {
  const ua = userAgent;
  const isIosDevice =
    /iPhone|iPod/.test(ua) || (/\biPad\b/.test(ua) && /Mobile/.test(ua));
  const isSafari =
    /Safari/i.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/i.test(ua);
  return isIosDevice && isSafari;
}

export function shouldShowHomeScreenInstallGuide(input: {
  isStandalone: boolean;
  userAgent: string;
}): boolean {
  if (input.isStandalone) {
    return false;
  }
  return isIosSafariBrowser(input.userAgent);
}

export function detectStandaloneFromWindow(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  const navigatorWithStandalone = window.navigator as Navigator & {
    standalone?: boolean;
  };

  return isStandaloneDisplayMode({
    displayModeStandalone: window.matchMedia("(display-mode: standalone)")
      .matches,
    navigatorStandalone: navigatorWithStandalone.standalone,
  });
}
