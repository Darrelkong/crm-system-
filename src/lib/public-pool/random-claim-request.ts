/**
 * Request validation helpers for POST /api/public-pool/claim-random.
 * Server-only — never bind batch size, seeds, or customer IDs from the client.
 */

export type RandomClaimBodyValidation =
  | { ok: true }
  | { ok: false; errorCode: string; error: string; httpStatus: number };

export function validateRandomClaimRequestBody(
  bodyText: string,
): RandomClaimBodyValidation {
  if (!bodyText.trim()) {
    return { ok: true };
  }

  let body: unknown;
  try {
    body = JSON.parse(bodyText) as unknown;
  } catch {
    return {
      ok: false,
      errorCode: "INVALID_REQUEST_BODY",
      error: "请求体无效",
      httpStatus: 400,
    };
  }

  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return {
      ok: false,
      errorCode: "INVALID_REQUEST_BODY",
      error: "请求体无效",
      httpStatus: 400,
    };
  }

  const keys = Object.keys(body as Record<string, unknown>);
  if (keys.length === 0) {
    return { ok: true };
  }

  return {
    ok: false,
    errorCode: "RANDOM_CLAIM_BODY_NOT_ALLOWED",
    error: "随机领取不可指定客户或其他参数",
    httpStatus: 400,
  };
}

export function randomClaimRoleGate(
  role: string,
): RandomClaimBodyValidation {
  if (role === "admin") {
    return {
      ok: false,
      errorCode: "RANDOM_CLAIM_STAFF_ONLY",
      error: "管理员请使用指定客户领取",
      httpStatus: 403,
    };
  }
  if (role !== "staff") {
    return {
      ok: false,
      errorCode: "FORBIDDEN",
      error: "无权领取",
      httpStatus: 403,
    };
  }
  return { ok: true };
}

export function idClaimStaffMethodGate(
  role: string,
): RandomClaimBodyValidation {
  if (role === "staff") {
    return {
      ok: false,
      errorCode: "CLAIM_METHOD_NOT_ALLOWED",
      error: "员工请使用随机领取",
      httpStatus: 403,
    };
  }
  return { ok: true };
}
