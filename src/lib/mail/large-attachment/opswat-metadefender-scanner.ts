import { resolveMailAttachmentDownloadFilename } from "@/lib/mail/mail-attachment-download-content-disposition";
import { resolveMailAttachmentDownloadContentType } from "@/lib/mail/mail-attachment-download-content-type";
import type {
  LargeAttachmentMalwareScanFailureCode,
  LargeAttachmentMalwareScanPollResult,
  LargeAttachmentMalwareScanner,
  LargeAttachmentMalwareScanSubmission,
} from "./large-attachment-malware-scanner";

export const OPSWAT_METADEFENDER_PROVIDER = "opswat-metadefender-cloud";
export const OPSWAT_METADEFENDER_API_KEY_ENV = "OPSWAT_METADEFENDER_API_KEY";
export const OPSWAT_METADEFENDER_DEFAULT_ENDPOINT =
  "https://api.metadefender.com/v4";

const SHA256_HEX = /^[0-9a-f]{64}$/;

export class OpswatMetaDefenderScanError extends Error {
  readonly code: LargeAttachmentMalwareScanFailureCode;
  readonly retryable: boolean;

  constructor(
    code: LargeAttachmentMalwareScanFailureCode,
    message: string,
    retryable: boolean,
  ) {
    super(message);
    this.name = "OpswatMetaDefenderScanError";
    this.code = code;
    this.retryable = retryable;
  }
}

export type OpswatMetaDefenderScannerOptions = {
  apiKey: string;
  endpoint?: string;
  fetchImpl?: typeof fetch;
  requestTimeoutMs?: number;
};

export type OpswatMetaDefenderEnv = {
  [OPSWAT_METADEFENDER_API_KEY_ENV]?: string;
};

type JsonRecord = Record<string, unknown>;

function requirePrivateHttpsEndpoint(endpoint: string): URL {
  const url = new URL(endpoint);
  if (url.protocol !== "https:") {
    throw new OpswatMetaDefenderScanError(
      "CONFIGURATION",
      "OPSWAT endpoint must use HTTPS",
      false,
    );
  }
  return new URL(url.toString().replace(/\/+$/, ""));
}

function normalizeProviderSha256(value: unknown): string | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  if (typeof value !== "string" || !SHA256_HEX.test(value.toLowerCase())) {
    throw new OpswatMetaDefenderScanError(
      "PROVIDER_INVALID_RESPONSE",
      "OPSWAT returned an invalid SHA-256 value",
      false,
    );
  }
  return value.toLowerCase();
}

async function readJson(response: Response): Promise<JsonRecord> {
  try {
    const value: unknown = await response.json();
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("not an object");
    }
    return value as JsonRecord;
  } catch {
    throw new OpswatMetaDefenderScanError(
      "PROVIDER_INVALID_RESPONSE",
      "OPSWAT returned an invalid JSON response",
      false,
    );
  }
}

function mapHttpFailure(response: Response): OpswatMetaDefenderScanError {
  if (response.status === 401 || response.status === 403) {
    return new OpswatMetaDefenderScanError(
      "PROVIDER_AUTH",
      "OPSWAT authentication failed",
      false,
    );
  }
  if (response.status === 408 || response.status === 429) {
    return new OpswatMetaDefenderScanError(
      response.status === 429 ? "PROVIDER_RATE_LIMIT" : "PROVIDER_TIMEOUT",
      "OPSWAT request should be retried",
      true,
    );
  }
  if (response.status >= 500) {
    return new OpswatMetaDefenderScanError(
      "PROVIDER_UNAVAILABLE",
      "OPSWAT service is unavailable",
      true,
    );
  }
  if (response.status === 400 || response.status === 415 || response.status === 422) {
    return new OpswatMetaDefenderScanError(
      "UNSUPPORTED_FILE",
      "OPSWAT rejected the file for scanning",
      false,
    );
  }
  return new OpswatMetaDefenderScanError(
    "PROVIDER_INVALID_RESPONSE",
    "OPSWAT returned an unexpected status",
    false,
  );
}

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function parseProviderReport(
  providerJobId: string,
  payload: JsonRecord,
): LargeAttachmentMalwareScanPollResult {
  const scanResults = asRecord(payload.scan_results);
  const fileInfo = asRecord(payload.file_info);
  const providerObservedSha256 = normalizeProviderSha256(
    fileInfo?.sha256 ?? fileInfo?.sha256_hash,
  );
  const progress = scanResults?.progress_percentage;
  const aggregateResult = scanResults?.scan_all_result_a;

  if (
    typeof progress !== "number" ||
    progress < 0 ||
    progress > 100 ||
    !Number.isInteger(progress)
  ) {
    throw new OpswatMetaDefenderScanError(
      "PROVIDER_INVALID_RESPONSE",
      "OPSWAT returned an invalid scan progress",
      false,
    );
  }
  if (progress < 100) {
    return {
      providerJobId,
      status: "pending",
      providerObservedSha256,
    };
  }

  if (aggregateResult === 0) {
    return {
      providerJobId,
      status: "clean",
      providerObservedSha256,
    };
  }
  if (aggregateResult === 1 || aggregateResult === 2) {
    return {
      providerJobId,
      status: "blocked",
      providerObservedSha256,
    };
  }
  if (aggregateResult === 253) {
    return {
      providerJobId,
      status: "scan_failed",
      providerObservedSha256,
      failureCode: "UNSUPPORTED_FILE",
      retryable: false,
    };
  }
  throw new OpswatMetaDefenderScanError(
    "PROVIDER_INVALID_RESPONSE",
    "OPSWAT returned an unknown completed verdict",
    false,
  );
}

export function createOpswatMetaDefenderScanner(
  options: OpswatMetaDefenderScannerOptions,
): LargeAttachmentMalwareScanner {
  if (!options.apiKey.trim()) {
    throw new OpswatMetaDefenderScanError(
      "CONFIGURATION",
      "OPSWAT API key is required",
      false,
    );
  }
  if (
    options.requestTimeoutMs !== undefined &&
    (!Number.isFinite(options.requestTimeoutMs) || options.requestTimeoutMs <= 0)
  ) {
    throw new OpswatMetaDefenderScanError(
      "CONFIGURATION",
      "OPSWAT request timeout must be positive",
      false,
    );
  }
  const endpoint = requirePrivateHttpsEndpoint(
    options.endpoint ?? OPSWAT_METADEFENDER_DEFAULT_ENDPOINT,
  );
  const fetchImpl = options.fetchImpl ?? fetch;
  const requestTimeoutMs = options.requestTimeoutMs ?? 30_000;

  async function request(
    url: URL,
    init: RequestInit,
  ): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
    try {
      const response = await fetchImpl(url, {
        ...init,
        signal: controller.signal,
      });
      if (!response.ok) {
        throw mapHttpFailure(response);
      }
      return response;
    } catch (error) {
      if (error instanceof OpswatMetaDefenderScanError) {
        throw error;
      }
      throw new OpswatMetaDefenderScanError(
        "PROVIDER_TIMEOUT",
        "OPSWAT request failed",
        true,
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  return {
    provider: OPSWAT_METADEFENDER_PROVIDER,

    async submit(input): Promise<LargeAttachmentMalwareScanSubmission> {
      const filename = resolveMailAttachmentDownloadFilename({
        displayFilename: input.filename,
        originalFilename: input.filename,
      });
      const response = await request(new URL(`${endpoint}/file`), {
        method: "POST",
        headers: {
          apikey: options.apiKey,
          samplesharing: "0",
          privateprocessing: "1",
          filename,
          "Content-Type": resolveMailAttachmentDownloadContentType(
            input.mimeType,
          ),
          "Content-Length": String(input.contentLength),
        },
        body: input.body,
      });
      const payload = await readJson(response);
      const providerJobId = payload.data_id;
      if (typeof providerJobId !== "string" || !providerJobId) {
        throw new OpswatMetaDefenderScanError(
          "PROVIDER_INVALID_RESPONSE",
          "OPSWAT did not return a scan data ID",
          false,
        );
      }
      return {
        providerJobId,
        status: "pending",
        providerObservedSha256: normalizeProviderSha256(
          asRecord(payload.file_info)?.sha256,
        ),
      };
    },

    async poll(input): Promise<LargeAttachmentMalwareScanPollResult> {
      const response = await request(
        new URL(`${endpoint}/file/${encodeURIComponent(input.providerJobId)}`),
        {
          method: "GET",
          headers: { apikey: options.apiKey },
        },
      );
      return parseProviderReport(
        input.providerJobId,
        await readJson(response),
      );
    },
  };
}

export function createOpswatMetaDefenderScannerFromEnv(
  env: OpswatMetaDefenderEnv,
  options?: Omit<OpswatMetaDefenderScannerOptions, "apiKey">,
): LargeAttachmentMalwareScanner {
  const apiKey = env[OPSWAT_METADEFENDER_API_KEY_ENV];
  if (!apiKey) {
    throw new OpswatMetaDefenderScanError(
      "CONFIGURATION",
      `${OPSWAT_METADEFENDER_API_KEY_ENV} is not configured`,
      false,
    );
  }
  return createOpswatMetaDefenderScanner({ ...options, apiKey });
}
