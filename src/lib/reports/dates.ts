export function getMonthStartIso(now: Date = new Date()): string {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
  ).toISOString();
}

export function getTodayRangeUtc(now: Date = new Date()): {
  start: string;
  end: string;
} {
  const dateKey = now.toISOString().slice(0, 10);
  return {
    start: `${dateKey}T00:00:00.000Z`,
    end: `${dateKey}T23:59:59.999Z`,
  };
}

export function getSevenDaysAgoIso(now: Date = new Date()): string {
  return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
}
