import type { Database } from "@/lib/db";
import type { User } from "../../../../drizzle/schema/users";
import type { Customer } from "../../../../drizzle/schema/customers";
import { getEffectiveAiSettings } from "@/lib/settings/ai-effective";
import {
  allowMockDeepInsightGeneration,
  resolveCustomerInsightProvider,
} from "@/lib/ai/providers/factory";
import { isExternalAiProviderKind } from "@/lib/ai/staff-usage/service";
import {
  completeStaffAiUsage,
  failStaffAiUsage,
  getStaffAiUsageSummary,
  reserveStaffAiUsage,
  type StaffAiReservation,
} from "@/lib/ai/staff-usage/service";
import { StaffAiQuotaError } from "@/lib/ai/staff-usage/service";
import {
  AiConfigError,
  AiDeepAnalysisGlobalDisabledError,
  AiDeepAnalysisMockOnlyError,
  AiProviderError,
  AiStaffDailyLimitReachedError,
  AiStaffDeepAnalysisDisabledError,
  AiStaffReservationConflictError,
} from "@/lib/ai/customer-insights/errors";
import { organizeFollowUpTextBasic } from "@/lib/ai/follow-up-organize/basic";
import { passesFollowUpOrganizeFactCheck } from "@/lib/ai/follow-up-organize/fact-check";
import { callFollowUpOrganizeProvider } from "@/lib/ai/follow-up-organize/provider";
import { safeParseFollowUpOrganizeAiOutput } from "@/lib/ai/follow-up-organize/schema";
import {
  FOLLOW_UP_ORGANIZE_MAX_LENGTH,
  FOLLOW_UP_ORGANIZE_MIN_LENGTH,
  FOLLOW_UP_ORGANIZE_SOURCE_AI,
  FOLLOW_UP_ORGANIZE_SOURCE_MOCK,
  type FollowUpOrganizationResult,
  type FollowUpOrganizeAvailability,
  type FollowUpOrganizeMode,
} from "@/lib/ai/follow-up-organize/types";
import { formatHongKongDateTime } from "@/lib/timezone";

export type { FollowUpOrganizeAvailability };

export class FollowUpOrganizeValidationError extends Error {
  readonly code:
    | "INPUT_EMPTY"
    | "INPUT_TOO_SHORT"
    | "INPUT_TOO_LONG"
    | "INVALID_MODE";

  constructor(
    code: FollowUpOrganizeValidationError["code"],
    message: string,
  ) {
    super(message);
    this.name = "FollowUpOrganizeValidationError";
    this.code = code;
  }
}

export class FollowUpOrganizeFactError extends Error {
  readonly code = "POSSIBLE_FACT_ADDED" as const;
  constructor(message = "整理結果疑似新增原文沒有的事實") {
    super(message);
    this.name = "FollowUpOrganizeFactError";
  }
}

function validateOrganizeText(text: unknown, mode: unknown): {
  text: string;
  mode: FollowUpOrganizeMode;
} {
  if (mode !== "basic" && mode !== "ai") {
    throw new FollowUpOrganizeValidationError("INVALID_MODE", "無效的整理模式");
  }
  if (typeof text !== "string") {
    throw new FollowUpOrganizeValidationError("INPUT_EMPTY", "請輸入跟進文字");
  }
  if (text.length > FOLLOW_UP_ORGANIZE_MAX_LENGTH) {
    throw new FollowUpOrganizeValidationError(
      "INPUT_TOO_LONG",
      "跟進文字過長",
    );
  }
  const trimmed = text.trim();
  if (!trimmed) {
    throw new FollowUpOrganizeValidationError("INPUT_EMPTY", "請輸入跟進文字");
  }
  if (trimmed.length < FOLLOW_UP_ORGANIZE_MIN_LENGTH) {
    throw new FollowUpOrganizeValidationError(
      "INPUT_TOO_SHORT",
      "跟進文字過短",
    );
  }
  return { text, mode };
}

export async function getFollowUpOrganizeAvailability(
  db: Database,
  user: User,
): Promise<FollowUpOrganizeAvailability> {
  const settings = await getEffectiveAiSettings(db);
  const staffUsage =
    user.role === "staff"
      ? await getStaffAiUsageSummary(db, user, settings)
      : null;
  const base = {
    canUseBasic: true,
    remaining: user.role === "staff" ? (staffUsage?.remaining ?? null) : null,
    dailyLimit: settings.aiStaffDailyLimit,
  };

  if (!settings.aiEnabled) {
    return { ...base, canUseAi: false, reason: "GLOBAL_DISABLED" };
  }
  if (settings.aiProvider === "mock" && !allowMockDeepInsightGeneration()) {
    return { ...base, canUseAi: false, reason: "MOCK_ONLY" };
  }
  if (!isExternalAiProviderKind(settings.aiProvider) && !allowMockDeepInsightGeneration()) {
    return { ...base, canUseAi: false, reason: "PROVIDER_UNAVAILABLE" };
  }
  if (user.role === "staff") {
    if (!settings.aiStaffDeepAnalysisEnabled) {
      return { ...base, canUseAi: false, reason: "STAFF_DISABLED" };
    }
    if (staffUsage && staffUsage.remaining <= 0) {
      return { ...base, canUseAi: false, reason: "LIMIT_REACHED" };
    }
  }
  return { ...base, canUseAi: true, reason: "AVAILABLE" };
}

export async function organizeFollowUpForUser(
  db: Database,
  user: User,
  input: {
    mode: unknown;
    text: unknown;
    reservationKey?: string;
    customer?: Customer | null;
  },
): Promise<FollowUpOrganizationResult> {
  const { text, mode } = validateOrganizeText(input.text, input.mode);
  const now = new Date();
  const generatedAt = now.toISOString();

  if (mode === "basic") {
    return organizeFollowUpTextBasic(text, { nowIso: generatedAt });
  }

  const settings = await getEffectiveAiSettings(db);
  if (!settings.aiEnabled && !allowMockDeepInsightGeneration()) {
    throw new AiDeepAnalysisGlobalDisabledError();
  }

  const resolved = resolveCustomerInsightProvider(settings);
  if (resolved.kind === "mock" && !allowMockDeepInsightGeneration()) {
    throw new AiDeepAnalysisMockOnlyError();
  }

  let reservation: StaffAiReservation | null = null;
  const needsStaffQuota =
    user.role === "staff" && isExternalAiProviderKind(resolved.kind);

  if (needsStaffQuota && !settings.aiStaffDeepAnalysisEnabled) {
    throw new AiStaffDeepAnalysisDisabledError();
  }

  if (needsStaffQuota) {
    try {
      reservation = await reserveStaffAiUsage(db, {
        user,
        settings,
        reservationKey:
          input.reservationKey?.trim() || crypto.randomUUID(),
        customerId: input.customer?.id ?? null,
        providerKind: resolved.kind,
        operationType: "follow_up_organization",
        now,
      });
    } catch (error) {
      if (error instanceof StaffAiQuotaError) {
        if (error.code === "AI_STAFF_DEEP_ANALYSIS_DISABLED") {
          throw new AiStaffDeepAnalysisDisabledError(error.message);
        }
        if (error.code === "AI_STAFF_RESERVATION_CONFLICT") {
          throw new AiStaffReservationConflictError(error.message);
        }
        throw new AiStaffDailyLimitReachedError(error.message);
      }
      throw error;
    }
  }

  // Idempotent succeeded replay: return basic-safe placeholder is wrong;
  // for organize, replay should re-run provider-free only if we cached —
  // we do not cache text. Return conflict is already handled above for
  // succeeded keys by returning reservation.reused succeeded without text.
  // Spec: succeeded replay short-circuit without provider. Without stored
  // organized text, return a conflict so client uses a new key.
  if (reservation?.reused && reservation.status === "succeeded") {
    throw new AiStaffReservationConflictError(
      "此用量保留鍵已完成，請重新發起整理",
    );
  }

  try {
    if (resolved.kind === "mock") {
      const basic = organizeFollowUpTextBasic(text, { nowIso: generatedAt });
      return {
        ...basic,
        source: FOLLOW_UP_ORGANIZE_SOURCE_MOCK,
        organizedText: basic.organizedText || text.trim(),
      };
    }

    if (!resolved.config) {
      throw new AiConfigError();
    }

    const raw = await callFollowUpOrganizeProvider({
      kind: resolved.kind,
      config: resolved.config,
      settings,
      text,
      referenceDateIso: formatHongKongDateTime(generatedAt, generatedAt),
    });

    const parsed = safeParseFollowUpOrganizeAiOutput(raw);
    if (!parsed.success) {
      throw new AiProviderError();
    }

    if (!passesFollowUpOrganizeFactCheck(text, parsed.data)) {
      throw new FollowUpOrganizeFactError();
    }

    const result: FollowUpOrganizationResult = {
      source: FOLLOW_UP_ORGANIZE_SOURCE_AI,
      originalText: text,
      organizedText: parsed.data.organizedText,
      extracted: parsed.data.extracted,
      warnings: parsed.data.warnings.map((w) => ({
        code: w.code,
        messageKey: `followUpOrganize.warnings.${warningCodeToKey(w.code)}`,
      })),
      generatedAt,
    };

    if (reservation) {
      await completeStaffAiUsage(db, {
        ...reservation,
        userId: user.id,
      });
    }
    return result;
  } catch (error) {
    if (reservation) {
      await failStaffAiUsage(db, {
        ...reservation,
        userId: user.id,
      });
    }
    throw error;
  }
}

function warningCodeToKey(code: string): string {
  switch (code) {
    case "TEXT_TOO_SHORT":
      return "textTooShort";
    case "NEXT_ACTION_MISSING":
      return "nextActionMissing";
    case "AMBIGUOUS_DATE":
      return "ambiguousDate";
    case "POSSIBLE_FACT_ADDED":
      return "possibleFactAdded";
    case "INPUT_EMPTY":
      return "inputEmpty";
    case "INPUT_TOO_LONG":
      return "inputTooLong";
    default:
      return "organizationFailed";
  }
}
