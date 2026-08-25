import type { MailReadFolder } from "@/lib/mail/client/mail-read-types";
import {
  composeDraftSeedPath,
  type ComposeDraftSeedMode,
  type DraftDetailApiItem,
} from "@/lib/mail/client/draft-management";

export type CreateComposeDraftFromMessageInput = {
  messageId: string;
  mode: ComposeDraftSeedMode;
  folder: MailReadFolder;
};

export type CreateComposeDraftFromMessageResult =
  | { ok: true; item: DraftDetailApiItem }
  | { ok: false; status: number; error: string; errorCode?: string };

export function resolveComposeDraftSeedErrorMessageKey(status: number): string {
  if (status === 404) {
    return "mail.compose.seedDraftUnavailable";
  }
  if (status === 403) {
    return "mail.status.accessUnavailable";
  }
  return "mail.compose.seedDraftFailed";
}

export type ComposeSeedRequestGuard = {
  isPending: () => boolean;
  begin: () => number;
  isCurrent: (requestId: number) => boolean;
  end: (requestId: number) => void;
};

export function createComposeSeedRequestGuard(): ComposeSeedRequestGuard {
  let pending = false;
  let currentRequestId = 0;

  return {
    isPending: () => pending,
    begin: () => {
      pending = true;
      currentRequestId += 1;
      return currentRequestId;
    },
    isCurrent: (requestId: number) => requestId === currentRequestId,
    end: (requestId: number) => {
      if (requestId === currentRequestId) {
        pending = false;
      }
    },
  };
}

export async function createComposeDraftFromMessage(
  input: CreateComposeDraftFromMessageInput,
  fetchImpl: typeof fetch = fetch,
): Promise<CreateComposeDraftFromMessageResult> {
  const res = await fetchImpl(composeDraftSeedPath(input.messageId), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      mode: input.mode,
      folder: input.folder,
    }),
  });

  if (!res.ok) {
    let error = "Failed to create compose draft";
    let errorCode: string | undefined;
    try {
      const body = (await res.json()) as { error?: string; errorCode?: string };
      error = body.error ?? error;
      errorCode = body.errorCode;
    } catch {
      // ignore parse failure
    }
    return { ok: false, status: res.status, error, errorCode };
  }

  const data = (await res.json()) as { item: DraftDetailApiItem };
  return { ok: true, item: data.item };
}
