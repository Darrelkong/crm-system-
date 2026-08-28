import type {
  AccessibleMailboxView,
  MailReadFolder,
  MailWorkspaceFolder,
} from "@/lib/mail/client/mail-read-types";
import { resolveEffectiveMailboxId } from "@/lib/mail/client/mail-workspace-mailbox-selection";

export const PRODUCTION_BOOTSTRAP_INITIAL_FOLDER: MailReadFolder = "inbox";

export type ProductionBootstrapCommand =
  | { type: "fetch-mailboxes" }
  | { type: "fetch-inbox"; mailboxId: string }
  | { type: "none" };

export type ProductionBootstrapSnapshot = {
  mailAccessEnabled: boolean;
  mailboxes: AccessibleMailboxView[];
  selectedMailboxId: string | null;
  selectedFolder: MailWorkspaceFolder;
  isLoadingMailboxes: boolean;
  isLoadingMessages: boolean;
  mailboxesFetchStarted: boolean;
  inboxLoadedMailboxId: string | null;
  inboxFetchInFlightMailboxId: string | null;
  mailboxesFetchInFlight: boolean;
};

export function resolveInitialProductionMailbox(
  mailboxes: AccessibleMailboxView[],
  selectedMailboxId: string | null,
): string | null {
  if (selectedMailboxId) {
    return selectedMailboxId;
  }

  return resolveEffectiveMailboxId({
    selectedMailboxId: null,
    mailboxes,
    bootstrapFallbackToFirst: true,
  });
}

export function nextProductionBootstrapCommand(
  snapshot: ProductionBootstrapSnapshot,
): ProductionBootstrapCommand {
  if (!snapshot.mailAccessEnabled) {
    return { type: "none" };
  }

  if (
    !snapshot.mailboxesFetchStarted &&
    !snapshot.mailboxesFetchInFlight &&
    !snapshot.isLoadingMailboxes
  ) {
    return { type: "fetch-mailboxes" };
  }

  if (snapshot.isLoadingMailboxes || snapshot.mailboxesFetchInFlight) {
    return { type: "none" };
  }

  const mailboxId = resolveInitialProductionMailbox(
    snapshot.mailboxes,
    snapshot.selectedMailboxId,
  );

  if (!mailboxId) {
    return { type: "none" };
  }

  if (snapshot.selectedMailboxId === mailboxId) {
    return { type: "none" };
  }

  if (snapshot.inboxLoadedMailboxId === mailboxId) {
    return { type: "none" };
  }

  if (
    snapshot.inboxFetchInFlightMailboxId === mailboxId ||
    snapshot.isLoadingMessages
  ) {
    return { type: "none" };
  }

  if (snapshot.selectedFolder !== PRODUCTION_BOOTSTRAP_INITIAL_FOLDER) {
    return { type: "none" };
  }

  return { type: "fetch-inbox", mailboxId };
}

export function createProductionBootstrapTracker() {
  let mailboxesFetchStarted = false;
  let inboxLoadedMailboxId: string | null = null;

  return {
    getMailboxesFetchStarted: () => mailboxesFetchStarted,
    getInboxLoadedMailboxId: () => inboxLoadedMailboxId,
    markMailboxesFetchStarted: () => {
      mailboxesFetchStarted = true;
    },
    markInboxLoaded: (mailboxId: string) => {
      inboxLoadedMailboxId = mailboxId;
    },
    reset: () => {
      mailboxesFetchStarted = false;
      inboxLoadedMailboxId = null;
    },
  };
}

export function buildProductionBootstrapSnapshot(input: {
  mailAccessEnabled: boolean;
  mailboxes: AccessibleMailboxView[];
  selectedMailboxId: string | null;
  selectedFolder: MailWorkspaceFolder;
  isLoadingMailboxes: boolean;
  isLoadingMessages: boolean;
  tracker: ReturnType<typeof createProductionBootstrapTracker>;
  mailboxesFetchInFlight: boolean;
  inboxFetchInFlightMailboxId: string | null;
}): ProductionBootstrapSnapshot {
  return {
    mailAccessEnabled: input.mailAccessEnabled,
    mailboxes: input.mailboxes,
    selectedMailboxId: input.selectedMailboxId,
    selectedFolder: input.selectedFolder,
    isLoadingMailboxes: input.isLoadingMailboxes,
    isLoadingMessages: input.isLoadingMessages,
    mailboxesFetchStarted: input.tracker.getMailboxesFetchStarted(),
    inboxLoadedMailboxId: input.tracker.getInboxLoadedMailboxId(),
    mailboxesFetchInFlight: input.mailboxesFetchInFlight,
    inboxFetchInFlightMailboxId: input.inboxFetchInFlightMailboxId,
  };
}
