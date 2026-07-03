import {
  DEVICE_COOKIE_NAME,
} from "@/lib/auth/constants";
import { DEVICE_COOKIE_TTL_MS } from "@/lib/devices/constants";
import { hashSessionToken } from "@/lib/auth/token";

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  const base64 = btoa(binary);
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function generateDeviceId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return bytesToBase64Url(bytes);
}

export async function hashDeviceId(deviceId: string): Promise<string> {
  return hashSessionToken(deviceId);
}

export function getDeviceCookieOptions(expiresAt: Date) {
  return {
    name: DEVICE_COOKIE_NAME,
    httpOnly: true,
    secure: isProduction(),
    sameSite: "lax" as const,
    path: "/",
    expires: expiresAt,
  };
}

export function getDeviceCookieExpiresAt(now = Date.now()): Date {
  return new Date(now + DEVICE_COOKIE_TTL_MS);
}

export type ResolvedDeviceId = {
  deviceId: string;
  isNew: boolean;
};

export function readDeviceIdFromCookieHeader(
  cookieHeader: string | null,
): string | null {
  if (!cookieHeader) {
    return null;
  }
  for (const part of cookieHeader.split(";")) {
    const [rawKey, ...rest] = part.trim().split("=");
    if (rawKey === DEVICE_COOKIE_NAME) {
      const value = decodeURIComponent(rest.join("="));
      return value.trim() || null;
    }
  }
  return null;
}

export function readDeviceIdFromRequest(request: Request): string | null {
  return readDeviceIdFromCookieHeader(request.headers.get("cookie"));
}

/** Read existing device cookie or generate a new id for this login attempt. */
export function resolveDeviceIdFromRequest(request: Request): ResolvedDeviceId {
  const existing = readDeviceIdFromRequest(request);
  if (existing) {
    return { deviceId: existing, isNew: false };
  }
  return { deviceId: generateDeviceId(), isNew: true };
}
