import type { RenderedNotificationPayload } from "@/lib/mail/notification-privacy-renderer";

export type NotificationTransportResult =
  | {
      outcome: "accepted";
      providerRequestId?: string;
    }
  | {
      outcome: "temporary_failure";
      errorCode: string;
      errorMessage?: string;
    }
  | {
      outcome: "permanent_failure";
      errorCode: string;
      errorMessage?: string;
    }
  | {
      outcome: "ambiguous";
    };

export type NotificationTransportInput = {
  targetEmail: string;
  payload: RenderedNotificationPayload;
  outboxId: string;
  attemptNumber: number;
};

export interface NotificationTransportAdapter {
  readonly providerId: string;
  send(input: NotificationTransportInput): Promise<NotificationTransportResult>;
}

export type FakeNotificationTransportMode =
  | "accepted"
  | "temporary_failure"
  | "permanent_failure"
  | "throw";

export class FakeNotificationTransportAdapter implements NotificationTransportAdapter {
  readonly providerId = "fake-notification-v1";

  constructor(private readonly mode: FakeNotificationTransportMode = "accepted") {}

  async send(
    input: NotificationTransportInput,
  ): Promise<NotificationTransportResult> {
    if (this.mode === "throw") {
      throw new Error("Fake notification transport ambiguous throw");
    }
    if (this.mode === "accepted") {
      return {
        outcome: "accepted",
        providerRequestId: `fake-req-${input.outboxId}-${input.attemptNumber}`,
      };
    }
    if (this.mode === "temporary_failure") {
      return {
        outcome: "temporary_failure",
        errorCode: "fake_temporary_failure",
        errorMessage: "Simulated temporary notification transport failure",
      };
    }
    return {
      outcome: "permanent_failure",
      errorCode: "fake_permanent_failure",
      errorMessage: "Simulated permanent notification transport failure",
    };
  }
}
