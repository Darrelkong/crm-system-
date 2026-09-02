"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { fetchMailSession } from "@/lib/mail/client/api";
import { isMailAccessDisabledError } from "@/lib/mail/client/mail-access-revalidation";
import {
  clearComposeContextCacheForActor,
  clearComposeContextCacheOnSessionEnd,
} from "@/lib/mail/client/compose-context-cache";
import { MAIL_ACCESS_DISABLED_EVENT } from "@/lib/mail/client/mail-access-revalidation";
import type { MailSessionContext } from "@/lib/mail/mail-session-context";
import {
  canAccessMailAdminCenter,
  resolveMailWorkspaceShellMode,
  type MailAdminCenterCapabilities,
  type MailWorkspaceShellMode,
} from "@/lib/mail/mail-session-context";

type MailSessionState = {
  session: MailSessionContext | null;
  loading: boolean;
  error: string | null;
  refresh: (options?: { background?: boolean }) => Promise<void>;
  mailAccessEnabled: boolean;
  effectiveMailAccessEnabled: boolean;
  effectiveGlobalMailRead: boolean;
  isCrmRootAdmin: boolean;
  workspaceShellMode: MailWorkspaceShellMode;
  capabilities: MailAdminCenterCapabilities;
  canOpenAdminCenter: boolean;
};

const DISABLED_CAPABILITIES: MailAdminCenterCapabilities = {
  canAccessMailAdminCenter: false,
  overview: false,
  accessManagement: false,
  notificationIdentityManagement: false,
  proofDiagnostics: false,
  senderIdentityManagement: false,
  signatureTemplateManagement: false,
  approvalReviewManagement: false,
  approvalWorkflowView: false,
  mailboxManagement: false,
  permissionManagement: false,
  deliveryHealth: false,
};

const MailSessionReactContext = createContext<MailSessionState | null>(null);

export function MailSessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<MailSessionContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const sessionRef = useRef<MailSessionContext | null>(null);
  const refreshInFlightRef = useRef<Promise<void> | null>(null);

  const refresh = useCallback(async (options: { background?: boolean } = {}) => {
    if (refreshInFlightRef.current) {
      return refreshInFlightRef.current;
    }

    const background =
      options.background ?? sessionRef.current !== null;
    const refreshPromise = (async () => {
      if (!background) {
        setLoading(true);
      }
      setError(null);
      try {
        const result = await fetchMailSession();
        if (!result.ok) {
          const accessDisabled = isMailAccessDisabledError(result);
          if (!background || accessDisabled) {
            sessionRef.current = null;
            setSession(null);
          }
          setError(result.error);
          return;
        }
        sessionRef.current = result.session;
        setSession(result.session);
      } catch {
        if (!background) {
          sessionRef.current = null;
          setSession(null);
        }
        setError("Network error");
      } finally {
        if (!background) {
          setLoading(false);
        }
      }
    })();

    refreshInFlightRef.current = refreshPromise;
    try {
      await refreshPromise;
    } finally {
      if (refreshInFlightRef.current === refreshPromise) {
        refreshInFlightRef.current = null;
      }
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const refreshIfVisible = () => {
      if (document.visibilityState === "visible") {
        void refresh({ background: true });
      }
    };
    const refreshOnFocus = () => void refresh({ background: true });
    const refreshOnAccessDenied = () => void refresh({ background: true });
    const interval = window.setInterval(refreshIfVisible, 60_000);

    window.addEventListener("focus", refreshOnFocus);
    document.addEventListener("visibilitychange", refreshIfVisible);
    window.addEventListener(MAIL_ACCESS_DISABLED_EVENT, refreshOnAccessDenied);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshOnFocus);
      document.removeEventListener("visibilitychange", refreshIfVisible);
      window.removeEventListener(
        MAIL_ACCESS_DISABLED_EVENT,
        refreshOnAccessDenied,
      );
    };
  }, [refresh]);

  useEffect(() => {
    if (!session?.user.id) {
      clearComposeContextCacheOnSessionEnd();
    } else if (!session.effectiveMailAccessEnabled) {
      clearComposeContextCacheForActor(session.user.id);
    }
  }, [session?.effectiveMailAccessEnabled, session?.user.id]);

  const capabilities = session?.capabilities ?? DISABLED_CAPABILITIES;
  const effectiveMailAccessEnabled =
    session?.effectiveMailAccessEnabled ?? false;
  const canOpenAdminCenter = canAccessMailAdminCenter(capabilities);
  const workspaceShellMode = resolveMailWorkspaceShellMode({
    mailAccessEnabled: session?.mailAccessEnabled ?? false,
    canAccessMailAdminCenter: canOpenAdminCenter,
  });

  const value = useMemo<MailSessionState>(
    () => ({
      session,
      loading,
      error,
      refresh,
      mailAccessEnabled: session?.mailAccessEnabled ?? false,
      effectiveMailAccessEnabled,
      effectiveGlobalMailRead: session?.effectiveGlobalMailRead ?? false,
      isCrmRootAdmin: session?.isCrmRootAdmin ?? false,
      workspaceShellMode,
      capabilities,
      canOpenAdminCenter,
    }),
    [
      session,
      loading,
      error,
      refresh,
      effectiveMailAccessEnabled,
      workspaceShellMode,
      capabilities,
      canOpenAdminCenter,
    ],
  );

  return (
    <MailSessionReactContext.Provider value={value}>
      {children}
    </MailSessionReactContext.Provider>
  );
}

export function useMailSession(): MailSessionState {
  const value = useContext(MailSessionReactContext);
  if (!value) {
    throw new Error("useMailSession must be used within MailSessionProvider");
  }
  return value;
}
