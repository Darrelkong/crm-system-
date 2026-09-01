"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { useMailSession } from "@/lib/mail/client/mail-session-provider";
import { MailReadSourceProvider } from "@/lib/mail/client/mail-read-source-context";
import {
  resolveMailReadSource,
  usesProductionMailReadSource,
  type MailReadSource,
} from "@/lib/mail/client/mail-read-source";
import {
  MailWorkspaceProvider,
  useMailWorkspace,
} from "@/lib/mail/client/mail-workspace-context";
import {
  buildProductionBootstrapSnapshot,
  createProductionBootstrapTracker,
  nextProductionBootstrapCommand,
  PRODUCTION_BOOTSTRAP_INITIAL_FOLDER,
} from "@/lib/mail/client/mail-workspace-bootstrap";

function MailProductionWorkspaceBootstrap() {
  const { mailAccessEnabled } = useMailSession();
  const workspace = useMailWorkspace();
  const trackerRef = useRef(createProductionBootstrapTracker());
  const mailboxesFetchInFlightRef = useRef(false);
  const inboxFetchInFlightRef = useRef<string | null>(null);

  useEffect(() => {
    if (!mailAccessEnabled) {
      workspace.clearSensitiveState();
      return;
    }

    const snapshot = buildProductionBootstrapSnapshot({
      mailAccessEnabled,
      mailboxes: workspace.mailboxes,
      selectedMailboxId: workspace.selectedMailboxId,
      selectedFolder: workspace.selectedFolder,
      isLoadingMailboxes: workspace.isLoadingMailboxes,
      isLoadingMessages: workspace.isLoadingMessages,
      tracker: trackerRef.current,
      mailboxesFetchInFlight: mailboxesFetchInFlightRef.current,
      inboxFetchInFlightMailboxId: inboxFetchInFlightRef.current,
    });

    const command = nextProductionBootstrapCommand(snapshot);
    if (command.type === "fetch-mailboxes") {
      if (mailboxesFetchInFlightRef.current) {
        return;
      }
      mailboxesFetchInFlightRef.current = true;
      void workspace.loadMailboxes().finally(() => {
        mailboxesFetchInFlightRef.current = false;
        trackerRef.current.markMailboxesFetchStarted();
      });
      return;
    }

    if (command.type === "fetch-inbox") {
      if (inboxFetchInFlightRef.current === command.mailboxId) {
        return;
      }
      inboxFetchInFlightRef.current = command.mailboxId;
      void workspace
        .loadMessages({
          mailboxId: command.mailboxId,
          folder: PRODUCTION_BOOTSTRAP_INITIAL_FOLDER,
          reset: true,
        })
        .finally(() => {
          if (inboxFetchInFlightRef.current === command.mailboxId) {
            inboxFetchInFlightRef.current = null;
          }
          trackerRef.current.markInboxLoaded(command.mailboxId);
        });
    }
  }, [
    mailAccessEnabled,
    workspace.mailboxes,
    workspace.selectedMailboxId,
    workspace.selectedFolder,
    workspace.isLoadingMailboxes,
    workspace.isLoadingMessages,
    workspace.loadMailboxes,
    workspace.loadMessages,
    workspace.clearSensitiveState,
  ]);

  return null;
}

export type MailWorkspaceDataSourceBoundaryProps = {
  children: ReactNode;
  source?: MailReadSource;
};

export function MailWorkspaceDataSourceBoundary({
  children,
  source = resolveMailReadSource(),
}: MailWorkspaceDataSourceBoundaryProps) {
  const content = usesProductionMailReadSource(source) ? (
    <MailWorkspaceProvider>
      <MailProductionWorkspaceBootstrap />
      {children}
    </MailWorkspaceProvider>
  ) : (
    children
  );

  return <MailReadSourceProvider source={source}>{content}</MailReadSourceProvider>;
}

export function shouldMountProductionWorkspaceProvider(
  source: MailReadSource,
): boolean {
  return usesProductionMailReadSource(source);
}
