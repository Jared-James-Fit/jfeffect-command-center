/**
 * Booking types (stored as booking_cards): the shared row shape and display
 * helpers. Online booking fields and the full type live in booking-types.ts.
 * Pure / browser-safe; DB access stays in components (RLS: coaches + admins).
 */

export type BookingCard = {
  id: string;
  name: string;
  session_type: string;
  custom_type: string | null;
  duration_minutes: number;
  location: string | null;
  default_notes: string | null;
  visible_to_client: boolean;
  client_visible_notes: boolean;
  reminders_enabled: boolean;
  send_confirmation_email: boolean;
  uses_credit: boolean;
  color: string | null;
  is_active: boolean;
  sort_order: number;
  created_at?: string;
  updated_at?: string;
};

export type CardAccent = {
  id: string;
  label: string;
  swatch: string;
  bar: string;
  chip: string;
};

export const CARD_ACCENTS: CardAccent[] = [
  { id: "gold", label: "Gold", swatch: "bg-primary", bar: "bg-primary", chip: "border-primary/40 bg-primary/10 text-primary" },
  { id: "green", label: "Green", swatch: "bg-success", bar: "bg-success", chip: "border-success/40 bg-success/10 text-success" },
  { id: "amber", label: "Amber", swatch: "bg-warning", bar: "bg-warning", chip: "border-warning/40 bg-warning/10 text-warning" },
  { id: "red", label: "Red", swatch: "bg-destructive", bar: "bg-destructive", chip: "border-destructive/40 bg-destructive/10 text-destructive" },
  { id: "slate", label: "Slate", swatch: "bg-muted-foreground", bar: "bg-muted-foreground", chip: "border-border bg-secondary/40 text-muted-foreground" },
];

export function cardAccent(color: string | null | undefined): CardAccent {
  return CARD_ACCENTS.find((c) => c.id === color) ?? CARD_ACCENTS[0];
}

export function fmtDuration(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** "09:00" + 75 → "10:15" */
export function addMinutesToTime(hhmm: string, minutes: number): string {
  const [h, m] = hhmm.split(":").map((x) => parseInt(x || "0", 10));
  const total = (h * 60 + m + minutes) % (24 * 60);
  const hh = String(Math.floor(total / 60)).padStart(2, "0");
  const mm = String(total % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}
