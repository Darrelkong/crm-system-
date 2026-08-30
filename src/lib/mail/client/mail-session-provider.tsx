"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { fetchMailSession } from "@/lib/mail/client/api";
import { clearComposeContextCacheOnSessionEnd } from "@/lib/mail/client/compose-context-cache";
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
  refresh: () => Promise<void>;
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

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchMailSession();
      if (!result.ok) {
        setSession(null);
        setError(result.error);
        return;
      }
      setSession(result.session);
    } catch {
      setSession(null);
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!session?.user.id) {
      clearComposeContextCacheOnSessionEnd();
    }
  }, [session?.user.id]);

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
