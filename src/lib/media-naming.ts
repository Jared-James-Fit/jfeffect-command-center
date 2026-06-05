// Build display-name strings for files uploaded to Google Drive so they
// match the spec: "{client_name} — {Label} — {YYYY-MM-DD} — {h:mm AM/PM}".
import type { MediaType } from "@/lib/media";

export function safeName(name: string) {
  return name.replace(/[\/\\?%*:|"<>]/g, "-").trim() || "Client";
}

export function fmtDriveDateTime(d: Date = new Date()) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = d.getHours();
  const min = String(d.getMinutes()).padStart(2, "0");
  const ampm = hh >= 12 ? "PM" : "AM";
  const h12 = ((hh + 11) % 12) + 1;
  return { date: `${yyyy}-${mm}-${dd}`, time: `${h12}:${min} ${ampm}` };
}

export function mediaLabel(type: MediaType | string): string {
  switch (type) {
    case "Lift Videos": return "Lift Video";
    case "Check-In Videos": return "Weekly Check-In Video";
    case "Progress Photos": return "Progress Photo";
    case "Training Videos": return "Training Video";
    case "Form Videos": return "Form Video";
    case "Technique Videos": return "Technique Video";
    case "Agreements": return "Agreement";
    case "Documents": return "Document";
    default: return String(type ?? "File");
  }
}

/**
 * Build the Drive display name (without file extension) per the naming spec.
 * Pass `index` (1-based) when more than one file is uploaded in the same
 * submission so files get a numeric suffix.
 */
export function buildDriveDisplayName(opts: {
  clientName: string | null | undefined;
  type: MediaType | string;
  index?: number;
  total?: number;
  at?: Date;
}): string {
  const { date, time } = fmtDriveDateTime(opts.at ?? new Date());
  const label = mediaLabel(opts.type);
  const total = opts.total ?? 1;
  const idx = opts.index ?? 1;
  const suffix = total > 1 ? ` ${idx}` : "";
  return `${safeName(opts.clientName ?? "Client")} — ${label}${suffix} — ${date} — ${time}`;
}