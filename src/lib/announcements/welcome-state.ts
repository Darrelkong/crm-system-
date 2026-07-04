const SESSION_KEY = "crm_welcome_seen";

/** Returns true if the welcome flow has been acknowledged in this browser session. */
export function hasSeenWelcomeThisSession(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  try {
    return sessionStorage.getItem(SESSION_KEY) === "1";
  } catch {
    return false;
  }
}

/** Mark the welcome flow as seen for this browser session. */
export function markWelcomeSeenThisSession(): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    sessionStorage.setItem(SESSION_KEY, "1");
  } catch {
    // ignore storage failures
  }
}

/** Clear the welcome seen flag (useful for testing or forced re-entry). */
export function clearWelcomeSeenThisSession(): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // ignore storage failures
  }
}
