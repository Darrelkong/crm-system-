import type {
  MailTransportAdapter,
  MailTransportSubmitResult,
  NormalizedOutboundSubmission,
} from "@/lib/mail/transport/mail-transport-adapter";

export type FakeTransportBehavior =
  | MailTransportSubmitResult
  | "throw";

export type FakeTransportCallCapture = {
  callCount: number;
  calls: NormalizedOutboundSubmission[];
};

/**
 * Deterministic fake transport for local tests only.
 * Outcome is configured at service/test injection boundary — NOT via HTTP.
 */
export class FakeMailTransportAdapter implements MailTransportAdapter {
  readonly providerId = "fake-local";
  private behaviorQueue: FakeTransportBehavior[] = [];
  readonly capture: FakeTransportCallCapture = { callCount: 0, calls: [] };

  queueBehavior(...behaviors: FakeTransportBehavior[]): this {
    this.behaviorQueue.push(...behaviors);
    return this;
  }

  setBehavior(behavior: FakeTransportBehavior): this {
    this.behaviorQueue = [behavior];
    return this;
  }

  async submitOutbound(
    input: NormalizedOutboundSubmission,
  ): Promise<MailTransportSubmitResult> {
    this.capture.callCount += 1;
    this.capture.calls.push(structuredClone(input));

    const behavior = this.behaviorQueue.shift() ?? {
      outcome: "accepted" as const,
      providerRequestId: `fake-req-${this.capture.callCount}`,
      providerMessageId: `fake-msg-${this.capture.callCount}`,
    };

    if (behavior === "throw") {
      throw new Error("Fake transport ambiguous failure");
    }

    return behavior;
  }
}
