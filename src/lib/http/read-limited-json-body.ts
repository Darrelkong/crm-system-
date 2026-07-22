import { QUICK_ENTRY_ERROR_CODES } from "@/lib/public-pool/quick-entry-constants";

export type ReadLimitedJsonSuccess = {
  ok: true;
  value: unknown;
  byteLength: number;
};

export type ReadLimitedJsonFailure = {
  ok: false;
  errorCode: string;
  message: string;
  httpStatus: number;
};

export type ReadLimitedJsonResult =
  | ReadLimitedJsonSuccess
  | ReadLimitedJsonFailure;

function mediaTypeOf(contentType: string | null): string {
  if (!contentType) return "";
  return contentType.split(";")[0]!.trim().toLowerCase();
}

/**
 * Reads a JSON body with a hard raw-byte limit.
 * Checks Content-Length when present, then always verifies actual ArrayBuffer size.
 * Does not return or log raw body contents on error.
 */
export async function readLimitedJsonBody(
  request: Request,
  maxBytes: number,
): Promise<ReadLimitedJsonResult> {
  const mediaType = mediaTypeOf(request.headers.get("content-type"));
  if (mediaType !== "application/json") {
    return {
      ok: false,
      errorCode: QUICK_ENTRY_ERROR_CODES.UNSUPPORTED_MEDIA_TYPE,
      message: "Content-Type 必须为 application/json",
      httpStatus: 415,
    };
  }

  const contentLengthHeader = request.headers.get("content-length");
  if (contentLengthHeader != null && contentLengthHeader !== "") {
    const declared = Number(contentLengthHeader);
    if (Number.isFinite(declared) && declared > maxBytes) {
      return {
        ok: false,
        errorCode: QUICK_ENTRY_ERROR_CODES.REQUEST_TOO_LARGE,
        message: "请求体过大",
        httpStatus: 413,
      };
    }
  }

  let buffer: ArrayBuffer;
  try {
    buffer = await request.arrayBuffer();
  } catch {
    return {
      ok: false,
      errorCode: "QUICK_ENTRY_BATCH_INVALID",
      message: "请求无效",
      httpStatus: 400,
    };
  }

  if (buffer.byteLength > maxBytes) {
    return {
      ok: false,
      errorCode: QUICK_ENTRY_ERROR_CODES.REQUEST_TOO_LARGE,
      message: "请求体过大",
      httpStatus: 413,
    };
  }

  if (buffer.byteLength === 0) {
    return {
      ok: false,
      errorCode: "QUICK_ENTRY_BATCH_INVALID",
      message: "请求无效",
      httpStatus: 400,
    };
  }

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    return {
      ok: false,
      errorCode: "QUICK_ENTRY_BATCH_INVALID",
      message: "请求无效",
      httpStatus: 400,
    };
  }

  try {
    return {
      ok: true,
      value: JSON.parse(text) as unknown,
      byteLength: buffer.byteLength,
    };
  } catch {
    return {
      ok: false,
      errorCode: "QUICK_ENTRY_BATCH_INVALID",
      message: "请求无效",
      httpStatus: 400,
    };
  }
}
