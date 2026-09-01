export const MAIL_ACCESS_DISABLED_EVENT = "crm:mail-access-disabled";

export function isMailAccessDisabledError(input: {
  status: number;
  errorCode?: string;
  error?: string;
}): boolean {
  return (
    input.status === 403 &&
    input.errorCode === "FORBIDDEN" &&
    input.error === "Mail access is not enabled for this user"
  );
}

export function notifyMailAccessDisabled(): void {
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(new Event(MAIL_ACCESS_DISABLED_EVENT));
}
