/**
 * Visits (app_sessions / app_page_views, Nov 23 2026): what one visit records, decided here so the
 * browser and the server agree. Pure.
 *
 * - A page is recorded as its path with ids taken out ("/portal/workouts/:id") and the feature it
 *   belongs to ("Workouts"), never a query string, a name or anything typed.
 * - A visit (session) ends when the app is closed or nobody's used it for 30 minutes.
 * - The device is a class (phone / tablet / desktop) and an operating system family, never a model;
 *   the platform is how they opened JF Effect (the iPhone or Android app, the home-screen app, a
 *   browser tab).
 * - A place comes only from the host's IP geolocation, on the server, kept to a city and a point
 *   rounded to 0.1° (about 11 km); this host gives only the country, so the point is the device's
 *   time zone's main city when that zone is in the same country (tz-places.ts). A browser sending
 *   Global Privacy Control or Do Not Track gets no place at all, and an anonymous public-site
 *   visitor who sends one isn't recorded.
 */

export type Surface = "site" | "app" | "admin";
export type Platform = "ios_app" | "android_app" | "home_screen" | "browser";
export type DeviceClass = "phone" | "tablet" | "desktop";
export type OsFamily = "ios" | "android" | "macos" | "windows" | "linux" | "chromeos" | "other";
export type BrowserFamily = "safari" | "chrome" | "firefox" | "edge" | "samsung" | "opera" | "instagram" | "facebook" | "tiktok" | "webview" | "other";

/** How long a visit survives with nobody using the app (matches the Crew feed's new-visit rule). */
export const SESSION_IDLE_MS = 30 * 60_000;
/** A heartbeat while the app is on screen; "live" is a heartbeat in the last 5 minutes. */
export const BEAT_MS = 60_000;
export const LIVE_WINDOW_MS = 5 * 60_000;

const ID_SEGMENT =
  /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\d{3,}|[0-9a-f]{16,}|[A-Za-z0-9_-]{20,})$/i;

/** "/portal/workouts/2f9c…" → "/portal/workouts/:id"; tokens and long ids never leave the phone. */
export function normalizePath(pathname: string): string {
  const clean = String(pathname || "/").split(/[?#]/)[0] || "/";
  const parts = clean.split("/").filter(Boolean);
  // a personal link's token (/b/<token>, /pay/<token>, /autopay/<token>, /sign/<token>) is always an id
  const tokenAfter = new Set(["b", "pay", "autopay", "sign", "p", "r"]);
  const out = parts.map((seg, i) => (ID_SEGMENT.test(seg) || (i > 0 && tokenAfter.has(parts[i - 1])) ? ":id" : seg.slice(0, 40)));
  return ("/" + out.join("/")).slice(0, 200);
}

export function surfaceOf(pathname: string): Surface {
  const p = String(pathname || "/");
  if (/^\/(admin|coach|finance)(\/|$)/.test(p)) return "admin";
  if (p.startsWith("/portal") || p.startsWith("/m/") || p === "/m" || p === "/app" || p === "/notifications") return "app";
  return "site";
}

type Rule = [RegExp, string];

// First match wins; most specific first.
const FEATURE_RULES: Rule[] = [
  // the app
  [/^\/portal\/?$/, "Home"],
  [/^\/portal\/workouts\/analytics/, "Training analytics"],
  [/^\/portal\/workouts\/prs/, "Records"],
  [/^\/portal\/workouts\/[^/]+$/, "Workout logger"],
  [/^\/portal\/workouts/, "Workouts"],
  [/^\/portal\/(schedule|exercises)/, "Workouts"],
  [/^\/portal\/programs\/import/, "Program import"],
  [/^\/portal\/programs\/new/, "Program builder"],
  [/^\/portal\/(programs|plans)/, "Programs"],
  [/^\/portal\/community/, "Crew"],
  [/^\/portal\/messages/, "Messages"],
  [/^\/portal\/support/, "Support"],
  [/^\/portal\/nutrition-studio/, "Nutrition studio"],
  [/^\/portal\/(nutrition|nutrition-targets|recipes)/, "Nutrition"],
  [/^\/portal\/(progress|progress-metrics|lift-videos|media)/, "Progress"],
  [/^\/portal\/(calendar|appointments|events)/, "Calendar"],
  [/^\/portal\/(check-in|check-ins)/, "Forms & check-ins"],
  [/^\/portal\/goals-setup/, "Goals & setup"],
  [/^\/portal\/competition/, "Competition"],
  [/^\/portal\/cardio/, "Cardio"],
  [/^\/portal\/(purchases|upgrade|membership)/, "Purchases"],
  [/^\/portal\/(account|agreements|documents)/, "Account"],
  [/^\/portal\/tools/, "Tools"],
  [/^\/portal/, "Other app pages"],
  [/^\/notifications/, "Notifications"],
  // staff
  [/^\/admin\/?$/, "Dashboard"],
  [/^\/admin\/messages/, "Messages (staff)"],
  [/^\/admin\/(clients|client-programs|client-pov)/, "Clients"],
  [/^\/admin\/(members|membership|member-plans)/, "Membership (staff)"],
  [/^\/admin\/(community|league|athlete-records)/, "Crew (staff)"],
  [/^\/admin\/(calendar|pt-calendar|appointments|booking-links|google-calendar)/, "Calendar (staff)"],
  [/^\/admin\/(program-library|programs|programming|blocks|program-assign|program-gaps|exercises|warmup-protocols|cardio-targets|recipes)/, "Programming"],
  [/^\/admin\/(forms|native-forms|check-ins|check-in-reviews|fillout-submissions)/, "Forms"],
  [/^\/admin\/(sales|purchases|payments|payment-links|products-history|offers|discount-codes|promo-codes|transactions|finance)/, "Sales"],
  [/^\/admin\/(leads)/, "Applications"],
  [/^\/admin\/tasks/, "Tasks"],
  [/^\/admin\/(usage)/, "Usage & spend"],
  [/^\/admin\/(insights)/, "Analytics"],
  [/^\/admin\/(settings|voice|chat-sounds|chat-gifs|legal|feature-flags)/, "Settings"],
  [/^\/admin\/(team|staff|coaches)/, "Team"],
  [/^\/admin\/(nutrition-dashboard|nutrition-targets)/, "Nutrition (staff)"],
  [/^\/admin/, "Other staff pages"],
  [/^\/(coach|finance)(\/|$)/, "Other staff pages"],
  // the public site
  [/^\/$/, "Landing"],
  [/^\/coaching\/apply/, "Coaching application"],
  [/^\/(coaching|personal-trainer-selkirk|selkirk)/, "Coaching page"],
  [/^\/about/, "About"],
  [/^\/(join|apply|membership|signup)/, "Join"],
  [/^\/(activate|welcome|setup|member-setup|staff-setup)/, "Account setup"],
  [/^\/(auth|recover|reset-password)/, "Sign in"],
  [/^\/(book|b)(\/|\.|$)/, "Booking"],
  [/^\/(pay|autopay)/, "Payments"],
  [/^\/challenges/, "Challenges"],
  [/^\/athletes/, "Athlete pages"],
  [/^\/p\//, "Shared posts"],
  [/^\/(privacy|terms|legal)/, "Legal"],
];

export function featureOf(pathname: string): string {
  const p = String(pathname || "/").split(/[?#]/)[0] || "/";
  for (const [re, name] of FEATURE_RULES) if (re.test(p)) return name;
  return "Other";
}

/** A visit is still the same one while it was used within SESSION_IDLE_MS. */
export function sessionStillGoing(lastActiveAt: number | null | undefined, now: number): boolean {
  return !!lastActiveAt && now - lastActiveAt < SESSION_IDLE_MS && now >= lastActiveAt - 60_000;
}

export function osOf(ua: string, platformHint?: string | null): OsFamily {
  const s = `${ua} ${platformHint ?? ""}`;
  if (/iPhone|iPad|iPod/i.test(s)) return "ios";
  if (/Android/i.test(s)) return "android";
  if (/CrOS/i.test(s)) return "chromeos";
  if (/Mac OS X|Macintosh|macOS/i.test(s)) return "macos";
  if (/Windows/i.test(s)) return "windows";
  if (/Linux/i.test(s)) return "linux";
  return "other";
}

/**
 * The browser family, from its user agent: an in-app browser (Instagram, Facebook, TikTok) is its
 * own family, since where a link was opened says where the visit came from. Never a version.
 */
export function browserOf(ua: string, native = false): BrowserFamily {
  const s = String(ua ?? "");
  if (/Instagram/i.test(s)) return "instagram";
  if (/FBAN|FBAV|FB_IAB|FBIOS|Messenger/i.test(s)) return "facebook";
  if (/musical_ly|BytedanceWebview|TikTok|trill_/i.test(s)) return "tiktok";
  if (native) return "webview";
  if (/SamsungBrowser/i.test(s)) return "samsung";
  if (/Edg(e|A|iOS)?\//.test(s)) return "edge";
  if (/OPR\/|Opera/.test(s)) return "opera";
  if (/Firefox\/|FxiOS\//.test(s)) return "firefox";
  if (/Chrome\/|CriOS\//.test(s)) return "chrome";
  if (/Safari\//.test(s) && /Version\//.test(s)) return "safari";
  if (/iPhone|iPad|iPod/.test(s)) return "webview";
  return "other";
}

/** iPadOS says "Macintosh"; a touch screen on a Mac is an iPad. */
export function osFor(ua: string, maxTouchPoints: number): OsFamily {
  const os = osOf(ua);
  return os === "macos" && maxTouchPoints > 1 ? "ios" : os;
}

/**
 * A visit's device class, with the OS known: the site funnel's own reading (a short side under 600
 * is a phone, a touch screen a tablet) except that a computer OS driven by a mouse is a computer,
 * whatever its screen. A 1366×768 or 1536×864 laptop is under 900 on its short side and read as a
 * tablet by size alone. An iPad says macOS but has touch, so osFor already calls it iOS.
 */
export function visitDevice(funnelDevice: DeviceClass | null, os: OsFamily, coarsePointer: boolean): DeviceClass | null {
  if (!funnelDevice || funnelDevice === "phone") return funnelDevice;
  if (!coarsePointer && (os === "windows" || os === "macos" || os === "linux" || os === "chromeos")) return "desktop";
  return funnelDevice;
}

export function platformOf(env: { native: "ios" | "android" | null; standalone: boolean }): Platform {
  if (env.native === "ios") return "ios_app";
  if (env.native === "android") return "android_app";
  if (env.standalone) return "home_screen";
  return "browser";
}

/** Global Privacy Control or Do Not Track: an opt-out the page honours. */
export function optedOut(nav: { globalPrivacyControl?: unknown; doNotTrack?: unknown } | null | undefined, win?: { doNotTrack?: unknown } | null): boolean {
  if (!nav) return false;
  if (nav.globalPrivacyControl === true) return true;
  const dnt = String(nav.doNotTrack ?? (win as any)?.doNotTrack ?? "");
  return dnt === "1" || dnt === "yes";
}

/** The host's geolocation, kept to a city and a point rounded to 0.1°. */
export function coarsePlace(raw: {
  country?: unknown;
  region?: unknown;
  city?: unknown;
  latitude?: unknown;
  longitude?: unknown;
}): { country: string | null; region: string | null; city: string | null; lat: number | null; lng: number | null } {
  const text = (v: unknown, max: number) => {
    const s = typeof v === "string" ? v.trim() : "";
    // Cloudflare's "XX" / "T1" mean unknown / Tor
    if (!s || s === "XX" || s === "T1") return null;
    try {
      return decodeURIComponent(s).slice(0, max);
    } catch {
      return s.slice(0, max);
    }
  };
  // a missing value is missing: Number(null) and Number("") are 0, which put every visit the host
  // gave no coordinates for at 0°, 0° in the Atlantic (Nov 23 2026)
  const num = (v: unknown, lim: number) => {
    if (v == null || (typeof v === "string" && !v.trim())) return null;
    const n = typeof v === "number" ? v : Number(v);
    if (!Number.isFinite(n) || Math.abs(n) > lim) return null;
    return Math.round(n * 10) / 10;
  };
  const country = text(raw.country, 2)?.toUpperCase() ?? null;
  let lat = num(raw.latitude, 90);
  let lng = num(raw.longitude, 180);
  // a point needs both halves, and 0°, 0° is the ocean, never a visitor
  if (lat == null || lng == null || (lat === 0 && lng === 0)) lat = lng = null;
  return {
    country: country && /^[A-Z]{2}$/.test(country) ? country : null,
    region: text(raw.region, 80),
    city: text(raw.city, 80),
    lat,
    lng,
  };
}

export const PLATFORM_LABEL: Record<string, string> = {
  ios_app: "iPhone app",
  android_app: "Android app",
  home_screen: "Home-screen app",
  browser: "Browser",
  unknown: "Not recorded",
};

export const DEVICE_LABEL: Record<string, string> = {
  phone: "Phone",
  tablet: "Tablet",
  desktop: "Computer",
  unknown: "Not recorded",
};
