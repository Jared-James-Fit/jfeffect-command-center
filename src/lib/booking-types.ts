/**
 * Booking types (booking_cards rows): what gets booked, and whether it can be
 * booked online. Pure helpers shared by the admin Booking tab, the public
 * booking page and the server.
 */
import type { HoursWindow } from "@/lib/booking-slots";

export type LocationMode = "in_person" | "video" | "phone";

export type BookingType = {
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
  slug: string | null;
  online_enabled: boolean;
  show_in_app: boolean;
  location_mode: LocationMode;
  description: string | null;
  timezone: string;
  min_notice_hours: number;
  max_advance_days: number;
  buffer_minutes: number;
  max_per_day: number | null;
  collect_phone: boolean;
  collect_notes: boolean;
  hours?: HoursWindow[];
};

/** Session types that are training (in the gym, uses a session by default). */
const TRAINING_TYPES = new Set([
  "Personal Training Session",
  "Technique Session",
  "Powerlifting Session",
  "Bodybuilding Session",
  "Assessment Session",
  "Custom Session",
]);

export function isTrainingSessionType(sessionType: string | null | undefined): boolean {
  return TRAINING_TYPES.has(String(sessionType ?? ""));
}

/** Training uses a session credit by default; calls and meetings don't. */
export function creditDefaultFor(sessionType: string | null | undefined): boolean {
  return isTrainingSessionType(sessionType);
}

export const LOCATION_MODES: Array<{ id: LocationMode; label: string; hint: string }> = [
  { id: "in_person", label: "In person", hint: "At the address below." },
  { id: "video", label: "Video call", hint: "A Google Meet link is made for each booking." },
  { id: "phone", label: "Phone call", hint: "You call them at the number they give." },
];

/** What the booker sees under "Where". */
export function locationLabel(t: Pick<BookingType, "location_mode" | "location">): string {
  if (t.location_mode === "video") return "Google Meet video call";
  if (t.location_mode === "phone") return "Phone call";
  return t.location?.trim() || "In person";
}

/** What's stored on the booked session / appointment as its location. */
export function bookedLocation(
  t: Pick<BookingType, "location_mode" | "location">,
  phone?: string | null,
): string | null {
  if (t.location_mode === "video") return "Video call (Google Meet)";
  if (t.location_mode === "phone") return phone ? `Phone call · ${phone}` : "Phone call";
  return t.location?.trim() || null;
}

/** Short address for cards ("800 Vaughan Ave Unit 404, Selkirk…" → "800 Vaughan Ave Unit 404"). */
export function shortPlace(t: Pick<BookingType, "location_mode" | "location">): string {
  if (t.location_mode !== "in_person") return locationLabel(t);
  return (t.location ?? "").split(",")[0].trim() || "In person";
}

export function bookingUrl(origin: string, slug: string): string {
  return `${origin.replace(/\/$/, "")}/book/${slug}`;
}

/** The address people should get: this site, unless it's a preview or local build. */
export function publicOrigin(): string {
  if (typeof window === "undefined") return "https://jfeffect.com";
  return /lovable|localhost|127\.0\.0\.1/.test(window.location.hostname)
    ? "https://jfeffect.com"
    : window.location.origin;
}

/** Starting points for a new type: the three things a coach actually books. */
export const TYPE_TEMPLATES: Array<{
  id: string;
  label: string;
  blurb: string;
  values: Partial<BookingType>;
}> = [
  {
    id: "pt",
    label: "Training session",
    blurb: "60 min · in person · uses a session",
    values: {
      name: "1:1 Training",
      session_type: "Personal Training Session",
      duration_minutes: 60,
      location_mode: "in_person",
      uses_credit: true,
      color: "gold",
      min_notice_hours: 12,
      buffer_minutes: 0,
    },
  },
  {
    id: "checkin",
    label: "Check-in call",
    blurb: "30 min · video · free",
    values: {
      name: "Check-in Call",
      session_type: "Check-In Session",
      duration_minutes: 30,
      location_mode: "video",
      uses_credit: false,
      color: "green",
      min_notice_hours: 12,
      buffer_minutes: 10,
    },
  },
  {
    id: "intro",
    label: "Intro call",
    blurb: "20 min · video · free, for new people",
    values: {
      name: "Free Intro Call",
      session_type: "Consultation",
      duration_minutes: 20,
      location_mode: "video",
      uses_credit: false,
      color: "slate",
      show_in_app: false,
      min_notice_hours: 4,
      buffer_minutes: 10,
    },
  },
];

export const DURATION_CHOICES = [15, 20, 30, 45, 60, 90];
export const NOTICE_CHOICES = [
  { hours: 2, label: "2 hours" },
  { hours: 12, label: "12 hours" },
  { hours: 24, label: "1 day" },
  { hours: 48, label: "2 days" },
];
export const ADVANCE_CHOICES = [
  { days: 14, label: "2 weeks" },
  { days: 30, label: "1 month" },
  { days: 60, label: "2 months" },
  { days: 90, label: "3 months" },
];
export const BUFFER_CHOICES = [0, 10, 15, 30];
