import {
  parseSessionEndReason,
  type SessionEndReason,
} from "@/lib/auth/client-security";
import { isIdleExemptActive } from "@/lib/auth/idle-exempt-ui";

/**
 * Whether the client should skip the local 30-minute idle timer.
 * Server /api/auth/me remains authoritative for revoke / device / access reverify.
 */
export function shouldSkipLocalIdleTimeout(input: {
  globalIdleTimeoutExempt: boolean;
  idleExemptUntilMs: number | null;
  nowMs: number;
}): boolean {
  if (input.globalIdleTimeoutExempt) {
    return true;
  }
  return isIdleExemptActive(input.idleExemptUntilMs, input.nowMs);
}

export type AuthMeSecurityResult =
  | { kind: "ok"; globalIdleTimeoutExempt: boolean }
  | { kind: "session_end"; reason: SessionEndReason }
  | { kind: "ignore" };

/**
 * Interpret GET /api/auth/me for IdleTimeoutProvider security polling.
 */
export function interpretAuthMeResponse(input: {
  status: number;
  errorCode?: string;
  globalIdleTimeoutExempt?: unknown;
}): AuthMeSecurityResult {
  if (input.status === 401) {
    const reason = parseSessionEndReason(input.errorCode);
    if (reason) {
      return { kind: "session_end", reason };
    }
    return { kind: "ignore" };
  }

  if (input.status >= 200 && input.status < 300) {
    return {
      kind: "ok",
      globalIdleTimeoutExempt: input.globalIdleTimeoutExempt === true,
    };
  }

  return { kind: "ignore" };
}

export type IdleCheckPlan =
  | {
      type: "end_session";
      reason: SessionEndReason;
      showModal: boolean;
      immediateRedirect: boolean;
    }
  | { type: "skip_local_idle"; globalIdleTimeoutExempt: boolean }
  | { type: "local_idle_expired" }
  | { type: "continue" };

/**
 * Plan IdleTimeoutProvider checkIdle after /api/auth/me has been attempted.
 * Me security outcomes always take priority over local idle.
 */
export function planIdleCheckAfterMe(input: {
  me: AuthMeSecurityResult;
  idleExemptUntilMs: number | null;
  nowMs: number;
  lastActivityMs: number | null;
  idleMs: number;
}): IdleCheckPlan {
  if (input.me.kind === "session_end") {
    const immediate = input.me.reason === "access_reverify";
    return {
      type: "end_session",
      reason: input.me.reason,
      showModal: !immediate,
      immediateRedirect: immediate,
    };
  }

  const globalExempt =
    input.me.kind === "ok" ? input.me.globalIdleTimeoutExempt : false;

  if (
    shouldSkipLocalIdleTimeout({
      globalIdleTimeoutExempt: globalExempt,
      idleExemptUntilMs: input.idleExemptUntilMs,
      nowMs: input.nowMs,
    })
  ) {
    return {
      type: "skip_local_idle",
      globalIdleTimeoutExempt: globalExempt,
    };
  }

  if (input.lastActivityMs == null) {
    return { type: "continue" };
  }

  if (input.nowMs - input.lastActivityMs > input.idleMs) {
    return { type: "local_idle_expired" };
  }

  return { type: "continue" };
}

/**
 * Login submit outcome for SESSION_ACCESS_REVERIFY_REQUIRED (and related).
 */
export type AccessReverifyLoginPlan =
  | { action: "redirect_access_logout" }
  | { action: "show_local_notice" };

export function planLoginAccessReverifyResponse(input: {
  isLocalDevelopment: boolean;
}): AccessReverifyLoginPlan {
  if (input.isLocalDevelopment) {
    return { action: "show_local_notice" };
  }
  return { action: "redirect_access_logout" };
}
