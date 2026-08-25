export type MailReadApiErrorBody = {
  error?: string;
  errorCode?: string;
};

export class MailReadApiError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = "MailReadApiError";
    this.status = status;
    this.code = code;
  }

  static validation(message: string, code = "VALIDATION") {
    return new MailReadApiError(400, message, code);
  }
}

export async function normalizeMailReadApiError(
  response: Response,
  fallbackMessage: string,
): Promise<MailReadApiError> {
  const body = (await response.json().catch(() => ({}))) as MailReadApiErrorBody;
  const message = body.error ?? fallbackMessage;
  const code = body.errorCode;

  switch (response.status) {
    case 400:
      return new MailReadApiError(400, message, code ?? "VALIDATION");
    case 401:
      return new MailReadApiError(401, message, code ?? "UNAUTHORIZED");
    case 403:
      return new MailReadApiError(403, message, code ?? "FORBIDDEN");
    case 404:
      return new MailReadApiError(404, message, code ?? "NOT_FOUND");
    default:
      if (response.status >= 500) {
        return new MailReadApiError(
          response.status,
          message || "Mail read request failed",
          code ?? "SERVER_ERROR",
        );
      }
      return new MailReadApiError(response.status, message, code);
  }
}

export function normalizeUnknownMailReadError(error: unknown): MailReadApiError {
  if (error instanceof MailReadApiError) {
    return error;
  }
  if (error instanceof Error) {
    return new MailReadApiError(500, error.message, "SERVER_ERROR");
  }
  return new MailReadApiError(500, "Mail read request failed", "SERVER_ERROR");
}
