// src/lib/dates.ts
//
// HeyPay is used in the Philippines, so its dates read in Philippine time. A
// fixed zone and locale also make the server (which runs in UTC) and the
// browser write the same text, so a page drawn on one matches the other.
const LOCALE = "en-PH";
const TIME_ZONE = "Asia/Manila";

/** "Oct 16, 2026" */
export function formatDay(date: Date | string): string {
  return new Date(date).toLocaleDateString(LOCALE, {
    timeZone: TIME_ZONE,
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** "Oct 16, 9:37 AM" */
export function formatDayTime(date: Date | string): string {
  return new Date(date).toLocaleString(LOCALE, {
    timeZone: TIME_ZONE,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
