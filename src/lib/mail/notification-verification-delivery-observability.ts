export const VERIFICATION_DELIVERY_LOG_PREFIX = "[verification-delivery]" as const;

export type VerificationDeliveryStage =
  | "ATTEMPT_INSERTED"
  | "CHALLENGE_GENERATION_STARTED"
  | "CHALLENGE_GENERATED"
  | "EMAIL_CONTENT_BUILD_STARTED"
  | "EMAIL_CONTENT_BUILT"
  | "DELIVERY_SINK_ENTERED"
  | "REST_FETCH_STARTED"
  | "REST_FETCH_RETURNED"
  | "REST_RESPONSE_CLASSIFIED"
  | "REST_FETCH_ABORTED"
  | "CHALLENGE_STATE_COMMIT_STARTED"
  | "CHALLENGE_STATE_COMMITTED"
  | "ATTEMPT_FINALIZE_STARTED"
  | "ATTEMPT_FINALIZED";

export type VerificationDeliveryObservationContext = {
  outboxId: string;
  attemptId: string;
  processingVersion: number;
  startedAtMs: number;
};

export function logVerificationDeliveryStage(
  context: VerificationDeliveryObservationContext,
  stage: VerificationDeliveryStage,
  details?: {
    httpStatus?: number;
    httpOk?: boolean;
    classification?: "accepted" | "temporary_failure" | "permanent_failure" | "ambiguous";
    elapsedMs?: number;
    errorCategory?: string;
  },
): void {
  console.log(
    VERIFICATION_DELIVERY_LOG_PREFIX,
    JSON.stringify({
      outboxId: context.outboxId,
      attemptId: context.attemptId,
      processingVersion: context.processingVersion,
      stage,
      elapsedMs: details?.elapsedMs ?? Date.now() - context.startedAtMs,
      ...(details?.httpStatus === undefined
        ? {}
        : { httpStatus: details.httpStatus }),
      ...(details?.httpOk === undefined ? {} : { httpOk: details.httpOk }),
      ...(details?.classification === undefined
        ? {}
        : { classification: details.classification }),
      ...(details?.errorCategory === undefined
        ? {}
        : { errorCategory: details.errorCategory }),
    }),
  );
}

export function classifySafeError(error: unknown): string {
  if (error instanceof Error) {
    return error.name || "Error";
  }
  if (typeof error === "string") {
    return "StringError";
  }
  return "UnknownError";
}
