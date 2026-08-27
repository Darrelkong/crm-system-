import { MAIL_ERROR_CODES, type MailErrorCode } from "./constants";

export class MailServiceError extends Error {
  readonly errorCode: MailErrorCode;
  readonly status: number;
  readonly metadata?: Record<string, unknown>;

  constructor(
    errorCode: MailErrorCode,
    message: string,
    status = 400,
    metadata?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "MailServiceError";
    this.errorCode = errorCode;
    this.status = status;
    this.metadata = metadata;
  }

  static validation(message: string, metadata?: Record<string, unknown>) {
    return new MailServiceError(
      MAIL_ERROR_CODES.VALIDATION,
      message,
      400,
      metadata,
    );
  }

  static forbidden(message = "Mail access denied") {
    return new MailServiceError(MAIL_ERROR_CODES.FORBIDDEN, message, 403);
  }

  static notFound(message = "Not found") {
    return new MailServiceError(MAIL_ERROR_CODES.NOT_FOUND, message, 404);
  }

  static conflict(message: string, metadata?: Record<string, unknown>) {
    return new MailServiceError(
      MAIL_ERROR_CODES.CONFLICT,
      message,
      409,
      metadata,
    );
  }

  static staleVersion(message = "Resource changed; retry with current state") {
    return new MailServiceError(MAIL_ERROR_CODES.STALE_VERSION, message, 409);
  }

  static integrityConflict(
    message: string,
    metadata?: Record<string, unknown>,
  ) {
    return new MailServiceError(
      MAIL_ERROR_CODES.INTEGRITY_CONFLICT,
      message,
      422,
      metadata,
    );
  }

  static rawPayloadNotAvailable(
    message = "Raw inbound payload is not available",
    metadata?: Record<string, unknown>,
  ) {
    return new MailServiceError(
      MAIL_ERROR_CODES.RAW_PAYLOAD_NOT_AVAILABLE,
      message,
      410,
      metadata,
    );
  }

  static ambiguousProviderState(
    message = "Ambiguous provider state requires admin review",
    metadata?: Record<string, unknown>,
  ) {
    return new MailServiceError(
      MAIL_ERROR_CODES.AMBIGUOUS_PROVIDER_STATE_REQUIRES_REVIEW,
      message,
      409,
      metadata,
    );
  }
}

export function mailErrorResponse(error: unknown): Response {
  if (error instanceof MailServiceError) {
    return Response.json(
      {
        error: error.message,
        errorCode: error.errorCode,
        ...(error.metadata ? { metadata: error.metadata } : {}),
      },
      { status: error.status },
    );
  }
  return Response.json(
    { error: "服务器错误", errorCode: "SERVER_ERROR" },
    { status: 500 },
  );
}
