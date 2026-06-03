export const SESSION_TYPES = [
  "Personal Training Session",
  "Technique Session",
  "Powerlifting Session",
  "Bodybuilding Session",
  "Check-In Session",
  "Assessment Session",
  "Consultation",
  "Custom Session",
] as const;

export const SESSION_STATUSES = [
  "Scheduled",
  "Completed",
  "Cancelled",
  "Rescheduled",
  "Missed",
] as const;

export const COMMON_TIMEZONES = [
  "America/Winnipeg",
  "America/Toronto",
  "America/Vancouver",
  "America/Edmonton",
  "America/Halifax",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Phoenix",
  "America/Anchorage",
  "Pacific/Honolulu",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Madrid",
  "Europe/Stockholm",
  "Asia/Dubai",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
  "Pacific/Auckland",
] as const;

export type SessionStatus = (typeof SESSION_STATUSES)[number];

export function statusTone(status: string): string {
  switch (status) {
    case "Scheduled":
      return "border-primary/40 bg-primary/10 text-primary";
    case "Completed":
      return "border-success/40 bg-success/10 text-success";
    case "Cancelled":
      return "border-border bg-secondary/40 text-muted-foreground";
    case "Rescheduled":
      return "border-warning/40 bg-warning/10 text-warning";
    case "Missed":
      return "border-destructive/40 bg-destructive/10 text-destructive";
    default:
      return "border-border text-muted-foreground";
  }
}

export function fmtSessionDateTime(date: string, time: string): string {
  try {
    const d = new Date(`${date}T${time}`);
    return d.toLocaleString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return `${date} ${time}`;
  }
}

export function fmtTimeRange(start: string, end: string): string {
  const fmt = (t: string) => {
    const [h, m] = t.split(":");
    const d = new Date();
    d.setHours(Number(h), Number(m), 0, 0);
    return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  };
  return `${fmt(start)} – ${fmt(end)}`;
}