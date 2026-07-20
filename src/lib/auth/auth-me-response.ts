import type { SessionValidationResult } from "@/lib/auth/session";

export type AuthMeSuccessPayload = {
  user: {
    id: string;
    email: string;
    displayName: string;
    role: string;
    mustChangePassword: boolean;
  };
  globalIdleTimeoutExempt: boolean;
};

/**
 * Build `/api/auth/me` success JSON from a successful SessionValidationResult.
 * Does not include epoch, Access iat, or other internal security settings.
 */
export function buildAuthMeSuccessPayload(
  validation: Extract<SessionValidationResult, { ok: true }>,
): AuthMeSuccessPayload {
  const { user } = validation.session;
  return {
    user: {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      role: user.role,
      mustChangePassword: user.mustChangePassword === 1,
    },
    globalIdleTimeoutExempt: validation.globalIdleTimeoutExempt,
  };
}
