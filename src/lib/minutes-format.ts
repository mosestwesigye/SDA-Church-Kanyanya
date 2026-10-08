/** Display helpers for board minutes. All times are shown in East Africa Time. */

const stamp = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Kampala", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
const longDay = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long", year: "numeric" });
const shortDay = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short", year: "numeric" });

/** "8 Oct 2026, 14:32 EAT" */
export const eat = (d: Date) => `${stamp.format(d)} EAT`;
/** Meeting dates are stored as calendar dates (UTC midnight). */
export const meetingDay = (d: Date) => longDay.format(d);
export const meetingDayShort = (d: Date) => shortDay.format(d);
/** "14:30" → "2:30 pm" */
export function clock(t: string | null) {
  if (!t) return null;
  const [h, m] = t.split(":").map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
}
export function fileSize(bytes: number) {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
export function fileKind(mime: string) {
  if (mime === "application/pdf") return "PDF";
  if (mime.startsWith("image/")) return "Image";
  if (mime.includes("wordprocessingml")) return "Word";
  return "File";
}
