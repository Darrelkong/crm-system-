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
import type { MailSessionContext } from "@/lib/mail/mail-session-context";
import {
  canAccessMailAdminCenter,
  type MailAdminCenterCapabilities,
} from "@/lib/mail/mail-session-context";

type MailSessionState = {
  session: MailSessionContext | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  mailAccessEnabled: boolean;
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

  const capabilities = session?.capabilities ?? DISABLED_CAPABILITIES;

  const value = useMemo<MailSessionState>(
    () => ({
      session,
      loading,
      error,
      refresh,
      mailAccessEnabled: session?.mailAccessEnabled ?? false,
      capabilities,
      canOpenAdminCenter: canAccessMailAdminCenter(capabilities),
    }),
    [session, loading, error, refresh, capabilities],
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
