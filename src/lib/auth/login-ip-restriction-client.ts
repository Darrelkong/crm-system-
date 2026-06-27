export type IpEmailRestrictionStatusResponse =
  | { restricted: false }
  | {
      restricted: true;
      errorCode: string;
      remainingSeconds: number;
      restrictedUntil: string;
    };

export const IP_EMAIL_RESTRICTION_STATUS_PATH =
  "/api/auth/login/ip-email-restriction";

export function ipRestrictedUntilFromPageLoadStatus(
  data: IpEmailRestrictionStatusResponse | null | undefined,
): string | null {
  if (!data || data.restricted !== true || !data.restrictedUntil) {
    return null;
  }
  return data.restrictedUntil;
}

export async function fetchIpEmailRestrictionStatus(): Promise<IpEmailRestrictionStatusResponse | null> {
  try {
    const response = await fetch(IP_EMAIL_RESTRICTION_STATUS_PATH, {
      cache: "no-store",
    });
    if (!response.ok) {
      return null;
    }
    return (await response.json()) as IpEmailRestrictionStatusResponse;
  } catch {
    return null;
  }
}
