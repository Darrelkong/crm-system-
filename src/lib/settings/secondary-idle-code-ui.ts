import { formatHongKongDateTime } from "@/lib/timezone";

export type SecondaryIdleCodeStatus = {
  enabled: boolean;
  generatedAt: string | null;
};

export type SecondaryIdleCodeUiState = {
  status: SecondaryIdleCodeStatus;
  revealedPlaintext: string | null;
  disableMessage: string | null;
};

export function parseSecondaryIdleCodeGetResponse(
  data: unknown,
): SecondaryIdleCodeStatus | null {
  if (!data || typeof data !== "object") return null;
  const record = data as Record<string, unknown>;
  if (typeof record.enabled !== "boolean") return null;
  const generatedAt =
    record.generatedAt === null || typeof record.generatedAt === "string"
      ? record.generatedAt
      : null;
  return { enabled: record.enabled, generatedAt };
}

export function formatSecondaryIdleCodeGeneratedAt(
  generatedAt: string | null,
): string {
  if (!generatedAt) return "未生成";
  return formatHongKongDateTime(generatedAt, "未生成");
}

export function getSecondaryIdleCodeStatusLabel(enabled: boolean): string {
  return enabled ? "已啟用" : "已停用";
}

export function parseSecondaryIdleCodeGenerateResponse(
  data: unknown,
): { plaintext: string } | { error: string } {
  if (!data || typeof data !== "object") {
    return { error: "生成失敗，請稍後再試。" };
  }
  const record = data as Record<string, unknown>;
  if (typeof record.plaintext === "string" && record.plaintext.length > 0) {
    return { plaintext: record.plaintext };
  }
  if (typeof record.error === "string" && record.error.length > 0) {
    return { error: record.error };
  }
  return { error: "生成失敗，請稍後再試。" };
}

export function parseSecondaryIdleCodeDisableResponse(
  data: unknown,
): { ok: true } | { error: string } {
  if (!data || typeof data !== "object") {
    return { error: "停用失敗，請稍後再試。" };
  }
  const record = data as Record<string, unknown>;
  if (record.ok === true) {
    return { ok: true };
  }
  if (typeof record.error === "string" && record.error.length > 0) {
    return { error: record.error };
  }
  return { error: "停用失敗，請稍後再試。" };
}

export function createInitialSecondaryIdleCodeUiState(): SecondaryIdleCodeUiState {
  return {
    status: { enabled: false, generatedAt: null },
    revealedPlaintext: null,
    disableMessage: null,
  };
}

export function applySecondaryIdleCodeStatusLoad(
  state: SecondaryIdleCodeUiState,
  status: SecondaryIdleCodeStatus,
): SecondaryIdleCodeUiState {
  return {
    ...state,
    status,
  };
}

export function applySecondaryIdleCodeGenerateSuccess(
  state: SecondaryIdleCodeUiState,
  plaintext: string,
  generatedAt: string,
): SecondaryIdleCodeUiState {
  return {
    status: { enabled: true, generatedAt },
    revealedPlaintext: plaintext,
    disableMessage: null,
  };
}

export function applySecondaryIdleCodeDismissRevealed(
  state: SecondaryIdleCodeUiState,
): SecondaryIdleCodeUiState {
  return {
    ...state,
    revealedPlaintext: null,
  };
}

export function applySecondaryIdleCodeDisableSuccess(
  state: SecondaryIdleCodeUiState,
): SecondaryIdleCodeUiState {
  return {
    status: { enabled: false, generatedAt: null },
    revealedPlaintext: null,
    disableMessage: "已停止使用二級密碼。",
  };
}
