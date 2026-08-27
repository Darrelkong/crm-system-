/** Stable classifier error code for ambiguous outbound provider dispatch. */
export const OUTBOUND_DISPATCH_UNCERTAIN_ERROR_CODE =
  "outbound_dispatch_uncertain" as const;

export function classifyThrownOutboundProviderDispatchError(
  error: unknown,
): { errorCode: string; errorMessage?: string } {
  if (error instanceof Error) {
    return {
      errorCode: OUTBOUND_DISPATCH_UNCERTAIN_ERROR_CODE,
      errorMessage: error.message,
    };
  }
  return {
    errorCode: OUTBOUND_DISPATCH_UNCERTAIN_ERROR_CODE,
    errorMessage: "Unknown provider dispatch failure",
  };
}

export function isTerminalSendOperationStatus(status: string): boolean {
  return (
    status === "accepted" ||
    status === "failed" ||
    status === "dispatch_uncertain"
  );
}

export function isAutomaticDispatchEligibleSendStatus(status: string): boolean {
  return status === "pending";
}
