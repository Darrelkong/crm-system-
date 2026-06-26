export const HONG_KONG_TIMEZONE = "Asia/Hong_Kong" as const;

const DISPLAY_LOCALE = "en-GB";

export type DateInput = Date | string | number | null | undefined;

/** Parse stored UTC timestamps; naive ISO strings without offset are treated as UTC. */
export function parseUtcDate(value: DateInput): Date | null {
  if (value == null || value === "") return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const trimmed = value.trim();
  if (!trimmed) return null;

  const naiveUtc =
    /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{3})?)?)?$/;
  if (naiveUtc.test(trimmed)) {
    const normalized = trimmed.replace(" ", "T");
    const date = new Date(`${normalized}Z`);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const date = new Date(trimmed);
  return Number.isNaN(date.getTime()) ? null : date;
}

function pad2(value: string): string {
  return value.padStart(2, "0");
}

function getDatePart(
  date: Date,
  options: Intl.DateTimeFormatOptions,
  type: Intl.DateTimeFormatPartTypes,
): string {
  return (
    new Intl.DateTimeFormat(DISPLAY_LOCALE, {
      timeZone: HONG_KONG_TIMEZONE,
      ...options,
    })
      .formatToParts(date)
      .find((part) => part.type === type)?.value ?? ""
  );
}

/** `YYYY-MM-DD HH:mm` in Asia/Hong_Kong */
export function formatHongKongDateTime(
  value: DateInput,
  fallback = "—",
): string {
  const date = parseUtcDate(value);
  if (!date) return fallback;

  const year = getDatePart(date, { year: "numeric" }, "year");
  const month = getDatePart(date, { month: "2-digit" }, "month");
  const day = getDatePart(date, { day: "2-digit" }, "day");
  const hour = getDatePart(date, { hour: "2-digit", hour12: false }, "hour");
  const minute = getDatePart(date, { minute: "2-digit" }, "minute");

  return `${year}-${month}-${day} ${pad2(hour)}:${pad2(minute)}`;
}

/** `YYYY-MM-DD` in Asia/Hong_Kong */
export function formatHongKongDate(value: DateInput, fallback = "—"): string {
  const date = parseUtcDate(value);
  if (!date) return fallback;

  const year = getDatePart(date, { year: "numeric" }, "year");
  const month = getDatePart(date, { month: "2-digit" }, "month");
  const day = getDatePart(date, { day: "2-digit" }, "day");

  return `${year}-${month}-${day}`;
}

/** `HH:mm` in Asia/Hong_Kong */
export function formatHongKongTime(value: DateInput, fallback = "—"): string {
  const date = parseUtcDate(value);
  if (!date) return fallback;

  const hour = getDatePart(date, { hour: "2-digit", hour12: false }, "hour");
  const minute = getDatePart(date, { minute: "2-digit" }, "minute");

  return `${pad2(hour)}:${pad2(minute)}`;
}
