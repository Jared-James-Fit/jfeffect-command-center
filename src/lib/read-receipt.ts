import { differenceInCalendarDays, format, parseISO } from "date-fns";

/**
 * Compact receipt text for an outbound message, e.g. "Read 11:47 AM",
 * "Read yesterday at 8:14 PM", "Read Mon 8:14 PM", "Read Oct 2".
 * Only call with a real read timestamp — never infer one.
 */
export function formatReadReceipt(readAtIso: string, now: Date = new Date()): string {
  const at = parseISO(readAtIso);
  const days = differenceInCalendarDays(now, at);
  if (days <= 0) return `Read ${format(at, "h:mm a")}`;
  if (days === 1) return `Read yesterday at ${format(at, "h:mm a")}`;
  if (days < 7) return `Read ${format(at, "EEE h:mm a")}`;
  return `Read ${format(at, "MMM d, h:mm a")}`;
}

/** Full stamp for message details, e.g. "Oct 3, 2026 · 11:47 AM". */
export function formatReceiptStamp(iso: string): string {
  return format(parseISO(iso), "MMM d, yyyy · h:mm a");
}

/** Same rules for the "Sent …" half of a receipt. */
export function formatSentReceipt(sentAtIso: string, now: Date = new Date()): string {
  return formatReadReceipt(sentAtIso, now).replace(/^Read/, "Sent");
}
