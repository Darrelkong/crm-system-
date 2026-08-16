/**
 * Shared synthetic fixtures for Customer State Engine V2 tests.
 *
 * Test-only helper (TASK 17-C1). No production module imports this file.
 */

import type {
  CustomerProfileFacts,
  CustomerStateFacts,
  FollowUpOutcomeFact,
} from "./types";

/** 2026-08-16 12:00 Asia/Hong_Kong. Fixed so every assertion is deterministic. */
export const NOW = new Date("2026-08-16T04:00:00.000Z");

export const HK_OFFSET_MS = 8 * 60 * 60 * 1000;
const MS_PER_HOUR = 60 * 60 * 1000;

/** Instant of a wall-clock time on a Hong Kong calendar date. */
export function hkInstant(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
  ms = 0,
): Date {
  return new Date(
    Date.UTC(year, month - 1, day, hour, minute, second, ms) - HK_OFFSET_MS,
  );
}

function hkDateParts(instant: Date): [number, number, number] {
  const shifted = new Date(instant.getTime() + HK_OFFSET_MS);
  return [
    shifted.getUTCFullYear(),
    shifted.getUTCMonth() + 1,
    shifted.getUTCDate(),
  ];
}

/**
 * ISO instant whose Hong Kong calendar-day difference to `now` is exactly
 * `days`. Noon local keeps it clear of midnight boundaries.
 */
export function hkDaysAgoIso(days: number, now: Date = NOW): string {
  const [year, month, day] = hkDateParts(now);
  return hkInstant(year, month, day - days, 12).toISOString();
}

export function hoursAgoIso(hours: number, now: Date = NOW): string {
  return new Date(now.getTime() - hours * MS_PER_HOUR).toISOString();
}

export function msAgoIso(ms: number, now: Date = NOW): string {
  return new Date(now.getTime() - ms).toISOString();
}

export function emptyProfile(): CustomerProfileFacts {
  return {
    customerName: null,
    nameStatus: "confirmed",
    phone: null,
    wechatId: null,
    email: null,
    requestedProjectCode: null,
    primaryConcern: null,
    notes: null,
    targetCountryOrRegion: null,
    preferredContactMethod: null,
    preferredName: null,
    gender: null,
    ageRange: null,
    preferredLanguage: null,
    occupation: null,
    companyName: null,
    jobTitle: null,
  };
}

/** REQUIRED + CORE satisfied, every OPTIONAL group unmet → `minor_gaps`. */
export function coreProfile(
  overrides: Partial<CustomerProfileFacts> = {},
): CustomerProfileFacts {
  return {
    ...emptyProfile(),
    customerName: "张三",
    nameStatus: "confirmed",
    phone: "13800000000",
    requestedProjectCode: "PROJ-1",
    notes: "背景说明",
    ...overrides,
  };
}

/** Every group satisfied → `complete` / 100. */
export function completeProfile(
  overrides: Partial<CustomerProfileFacts> = {},
): CustomerProfileFacts {
  return {
    customerName: "张三",
    nameStatus: "confirmed",
    phone: "13800000000",
    wechatId: "wx-zhangsan",
    email: "zhangsan@example.com",
    requestedProjectCode: "PROJ-1",
    primaryConcern: "移民时间",
    notes: "背景说明",
    targetCountryOrRegion: "加拿大",
    preferredContactMethod: "wechat",
    preferredName: "三哥",
    gender: "male",
    ageRange: "35-44",
    preferredLanguage: "zh",
    occupation: "工程师",
    companyName: "示例公司",
    jobTitle: "总监",
    ...overrides,
  };
}

export function outcome(
  outcomeValue: string,
  followUpTime: string | null,
): FollowUpOutcomeFact {
  return { outcome: outcomeValue, followUpTime };
}

export function repeatOutcome(
  outcomeValue: string,
  count: number,
  daysAgo: number,
  now: Date = NOW,
): FollowUpOutcomeFact[] {
  return Array.from({ length: count }, (_, index) =>
    outcome(outcomeValue, hkDaysAgoIso(daysAgo + index, now)),
  );
}

/**
 * Baseline facts: an owned, active `new_lead` created at `NOW` with no
 * interaction history and a `minor_gaps` profile. Reclamation resolves to
 * `none` (idle 0 of 55) so each test only overrides what it exercises.
 */
export function stateFacts(
  overrides: Partial<CustomerStateFacts> = {},
): CustomerStateFacts {
  return {
    salesStage: "new_lead",
    status: "active",
    ownerId: "user-1",
    hasCollaborator: false,
    isPinned: 0,
    createdAt: NOW.toISOString(),
    lastValidFollowUpAt: null,
    nextFollowUpAt: null,
    reclamationCycleStartedAt: null,
    reclaimRuleGraceUntil: null,
    followUpOutcomes: [],
    profile: coreProfile(),
    businessTimezone: "Asia/Hong_Kong",
    automaticReclaimDays: 55,
    ...overrides,
  };
}
