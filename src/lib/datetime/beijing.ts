import { BUSINESS_UTC_OFFSET_MS } from "@/lib/reports/dates";

/** Current wall-clock in Asia/Shanghai as `datetime-local` value (YYYY-MM-DDTHH:mm). */
export function getBeijingDatetimeLocalValue(now = new Date()): string {
  const shifted = new Date(now.getTime() + BUSINESS_UTC_OFFSET_MS);
  const year = shifted.getUTCFullYear();
  const month = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const day = String(shifted.getUTCDate()).padStart(2, "0");
  const hour = String(shifted.getUTCHours()).padStart(2, "0");
  const minute = String(shifted.getUTCMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hour}:${minute}`;
}
