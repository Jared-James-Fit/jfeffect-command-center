function pad(n: number): string { return String(n).padStart(2, "0"); }
function fmt(d: Date): string {
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}
function esc(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

export interface IcsAppointment {
  id: string;
  title: string;
  starts_at: string;
  ends_at: string;
  location?: string | null;
  meet_link?: string | null;
  attendee_notes?: string | null;
}

export function buildAppointmentIcs(a: IcsAppointment, origin = "jfeffect.com"): string {
  const desc = [a.attendee_notes ?? null, a.meet_link ? `Join: ${a.meet_link}` : null]
    .filter(Boolean)
    .join("\n");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//JFEffect//Appointments//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${a.id}@${origin}`,
    `DTSTAMP:${fmt(new Date())}`,
    `DTSTART:${fmt(new Date(a.starts_at))}`,
    `DTEND:${fmt(new Date(a.ends_at))}`,
    `SUMMARY:${esc(a.title)}`,
    desc ? `DESCRIPTION:${esc(desc)}` : null,
    a.location ? `LOCATION:${esc(a.location)}` : null,
    a.meet_link ? `URL:${esc(a.meet_link)}` : null,
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter(Boolean);
  return lines.join("\r\n");
}

export function downloadIcs(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".ics") ? filename : `${filename}.ics`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}