/**
 * The iPhone app (the Capacitor shell, `isNative()` from "@/platform") never
 * sells, prices or points to a purchase: no buy button, no price, no plan
 * comparison, no sales page, and no link or redirect to a web checkout or a
 * sign-up that takes a payment (App Store guidelines 3.1.1 / 3.1.3; App
 * Review rejected build 35 for "subscription purchase link-out to Safari via
 * account registration"). A new person in the app can only apply for the free
 * account or sign in. Coaching (1:1, person-to-person, 3.1.3(d)) is paid
 * outside the app too, and the app never links there.
 *
 * Nothing digital bought outside the app is unlocked in it either (3.1.1;
 * Jared chose option B, docs/APPLE_IAP_DECISION.md): in the app a self-serve
 * member gets the free experience whatever they hold (no Premium, no paid
 * membership access keys, no bought AI credits), and the paid parts are
 * hidden, never shown locked. Coaching clients (a person-to-person service,
 * 3.1.3(d)/(e)) and staff keep everything; the web is unchanged.
 * `digitalPaidAllowed` is that rule; the screens ask it through
 * `useDigitalPaidAllowed` (service-tier.ts) and the server through
 * `digitalPaidAllowedFor` (native-purchases.server.ts), which knows the app's
 * requests by `isNativeAppRequest` (the build's user-agent stamp, or the
 * header start.ts adds to every server call from the app).
 *
 * This file is the one guard. Pure rules (tested in native-purchases.test.ts
 * and native-shell-routes.test.ts) plus the runtime pieces that use them:
 * - `isShellBlockedPath`: pages the app never opens (sales, pricing, checkout,
 *   billing, coaching sign-up); the root route sends them to "/" (`shellRedirect`).
 * - `isPurchaseUrl`: a link or window.open to one of those pages or to a Stripe
 *   payment page; `installShellPurchaseGuard` swallows the tap in the app.
 * - `goToPayment`: the one way a screen sends someone to a checkout; refused in the app.
 * - `NATIVE_SHELL_BOOT_SCRIPT`: marks <html data-native-shell> before the first
 *   paint, so anything marked `data-web-only` never shows in the app (styles.css).
 * Every surface that could sell or promote something asks here instead of
 * keeping its own list.
 */
import { useSyncExternalStore } from "react";
import { isNative } from "@/platform";

/** What the app says when a purchase is refused in the shell: no pointer to the web. */
export const NATIVE_PURCHASE_BLOCKED = "Not available in the app";

/** Where something is bought or its price is shown: never linked to from the iPhone app. */
const BUY_PATH = /^\/(?:premium|membership|coaching|join|pay|autopay|checkout|buy|upgrade|pricing|credits|portal\/(?:plan|upgrade|membership|credits))(?:[/?#]|$)/i;

export function isBuyPath(path: string | null | undefined): boolean {
  return !!path && BUY_PATH.test(path);
}

/**
 * Pages the iPhone app never opens. Sales and pricing pages (coaching and its
 * application, About, the old membership and Selkirk pages), checkout and
 * payment links (/pay, /autopay, the paid sign-up's /m/welcome), and the
 * billing pages (Your plan, Membership billing, My purchases). The free
 * application (/join), sign-in, activation, booking a call with your coach and
 * everything you use stay open.
 */
const SHELL_BLOCKED_PATH =
  /^\/(?:premium|membership|coaching|apply|about|pricing|checkout|buy|upgrade|credits|pay|autopay|personal-trainer-selkirk|selkirk|m\/(?:welcome|upgrade|plan|membership|purchases)|portal\/(?:plan|upgrade|membership|purchases|credits))(?:[/?#]|$)/i;

export function isShellBlockedPath(path: string | null | undefined): boolean {
  return !!path && SHELL_BLOCKED_PATH.test(path);
}

/** Stripe's hosted payment pages (Checkout, Payment Links, the customer portal, invoices). */
const PAYMENT_HOSTS = new Set([
  "checkout.stripe.com",
  "buy.stripe.com",
  "billing.stripe.com",
  "invoice.stripe.com",
  "pay.stripe.com",
  "payments.stripe.com",
]);
const OWN_HOSTS = new Set(["jfeffect.com", "www.jfeffect.com"]);

/** A link (absolute or relative to `base`) to a page the app never opens or to a payment page. */
export function isPurchaseUrl(url: string | null | undefined, base = "https://jfeffect.com/"): boolean {
  if (!url) return false;
  let u: URL;
  try {
    u = new URL(url, base);
  } catch {
    return false;
  }
  const host = u.hostname.toLowerCase();
  if (PAYMENT_HOSTS.has(host)) return true;
  let own = OWN_HOSTS.has(host);
  try {
    own ||= host === new URL(base).hostname.toLowerCase();
  } catch {
    /* a bad base: only jfeffect.com counts as ours */
  }
  return own && isShellBlockedPath(u.pathname);
}

const noSubscribe = () => () => {};
/** `isNative()` for a component the server also renders: false on the server and while hydrating, then the truth. */
export function useNativeShell(): boolean {
  return useSyncExternalStore(noSubscribe, isNative, () => false);
}

/** Where the app goes instead of a blocked page: its start ("/" opens Crew, or sign-in). */
export function shellRedirectFor(path: string, native: boolean): string | null {
  return native && isShellBlockedPath(path) ? "/" : null;
}

/** The same, for this device (null on the web and during SSR). */
export function shellRedirect(path: string): string | null {
  return shellRedirectFor(path, isNative());
}

// Staff (admin, coach, media, finance) keep their business tools in the app: sending a
// client a payment link or opening one to take a payment at the gym. Set from the
// signed-in role (`ShellPurchaseGuard`); never true for a client or member.
let shellStaff = false;
export const SHELL_STAFF_ROLES: readonly string[] = ["admin", "coach", "media_manager", "finance"];
export function setShellStaff(role: string | null | undefined) {
  shellStaff = !!role && SHELL_STAFF_ROLES.includes(role);
}

/** Whether this device's app may follow a link to `url` (false only for a purchase, in the app, for a non-staff login). */
export function shellAllowsUrl(url: string | null | undefined, native: boolean, base?: string): boolean {
  return !native || shellStaff || !isPurchaseUrl(url, base);
}

/**
 * The one way a screen sends someone to a checkout or payment page. In the
 * app it does nothing and says so (false); the screens that call it are
 * hidden there anyway, this is the backstop.
 */
export function goToPayment(url: string): boolean {
  if (typeof window === "undefined") return false;
  if (!shellAllowsUrl(url, isNative(), window.location.href)) return false;
  window.location.assign(url);
  return true;
}

type GuardWindow = {
  location: { href: string };
  open: (...args: any[]) => any;
  addEventListener: (type: "click", fn: (e: any) => void, capture: boolean) => void;
  __jfShellGuard?: boolean;
};

/**
 * In the app: a tap on any link to a purchase (a chat message, a Cleo answer, a
 * popup, a promo, a link nobody remembered to hide) does nothing, and
 * window.open refuses one. Runs before React's own handlers (window, capture),
 * so a router <Link> never navigates either. Installed once by native-init.ts.
 */
export function installShellPurchaseGuard(win: GuardWindow) {
  if (win.__jfShellGuard) return;
  win.__jfShellGuard = true;
  win.addEventListener(
    "click",
    (e: any) => {
      const a = e?.target?.closest?.("a[href]");
      const href = a?.getAttribute?.("href");
      if (!href || shellAllowsUrl(href, true, win.location.href)) return;
      e.preventDefault();
      e.stopImmediatePropagation?.();
      e.stopPropagation?.();
    },
    true,
  );
  const open = win.open.bind(win);
  win.open = (url?: unknown, ...rest: unknown[]) =>
    url != null && !shellAllowsUrl(String(url), true, win.location.href) ? null : open(url, ...rest);
}

/**
 * Before the first paint: <html data-native-shell> inside the iPhone app (its
 * bridge, or the build's "JFEffectApp/" user-agent stamp), so `data-web-only`
 * is hidden from the start (no flash), and a blocked page opened cold (a
 * reload, a deep link) goes straight to "/".
 */
export const NATIVE_SHELL_BOOT_SCRIPT = `(function(){try{var c=window.Capacitor;var n=!!(c&&(typeof c.isNativePlatform==="function"?c.isNativePlatform():c.isNative))||/JFEffectApp\\//.test(navigator.userAgent);if(!n)return;document.documentElement.setAttribute("data-native-shell","");if(${SHELL_BLOCKED_PATH.toString()}.test(location.pathname))location.replace("/")}catch(e){}})();`;

/** A menu's rows in the app: none that opens a page the app never opens (My Purchases, Membership). */
export function navForShell<T extends { to: string }>(items: readonly T[], native: boolean): T[] {
  return native ? items.filter((i) => !isShellBlockedPath(i.to)) : [...items];
}

/** A Crew promo that points at something to buy (or a page the app never opens) is for the web app only. */
export function promosForShell<T extends { cta_path: string }>(promos: readonly T[], native: boolean): T[] {
  return native ? promos.filter((p) => !isBuyPath(p.cta_path) && !isShellBlockedPath(p.cta_path)) : [...promos];
}

/** The free application's screens in the app: no "Interested in online coaching?" (a paid service). */
export function joinStepsForShell<K extends string>(steps: readonly K[], native: boolean): K[] {
  return native ? steps.filter((k) => k !== "coaching_interest") : [...steps];
}

/** A payment card in a chat (a payment request, an auto-pay setup): no amount or pay button for the client in the app. */
export function shellHidesPayment(staff: boolean, native: boolean): boolean {
  return native && !staff;
}

type Switchable = { transition: { available: boolean; blocked?: string | null; kind?: string } };

/** True for a plan the person can't take here only because the app doesn't sell. */
export function blockedForShell(o: Switchable): boolean {
  return !o.transition.available && o.transition.blocked === NATIVE_PURCHASE_BLOCKED;
}

/**
 * The other plans the app lists: in the iPhone app, no plan that needs a
 * purchase (the engine refuses it with NATIVE_PURCHASE_BLOCKED); switching
 * down, moving to the free app and asking the coach stay.
 */
export function plansForShell<T extends Switchable>(options: readonly T[], native: boolean): T[] {
  return native ? options.filter((o) => !blockedForShell(o)) : [...options];
}

/** Whether to print a plan's price: never for a plan the person isn't on, inside the app. */
export function showPlanPrice(o: { transition: { kind?: string; blocked?: string | null } }, native: boolean): boolean {
  if (!native) return true;
  return o.transition.kind === "current" && o.transition.blocked === "Your current plan";
}

/* ───────────── Option B: nothing digital bought outside the app is unlocked in it ───────────── */

/** The header the app's own code adds to every server call made inside the iPhone app (start.ts). */
export const NATIVE_APP_HEADER = "x-jf-native-app";
/** The iOS build's stamp on the web view's user agent ("JFEffectApp/1850", ios-build.yml). */
const NATIVE_UA_STAMP = /JFEffectApp\//;

/** A request made from inside the iPhone app: its user-agent stamp, or the app's header. */
export function isNativeAppRequest(h: { userAgent?: string | null; nativeHeader?: string | null }): boolean {
  return NATIVE_UA_STAMP.test(h.userAgent ?? "") || !!h.nativeHeader;
}

/**
 * Whether paid digital features (Premium, paid-membership access, bought AI
 * credits) are on for this person here. Always on the web. In the app only for
 * staff and coaching clients: coaching (1:1 and in person) is a
 * person-to-person service (3.1.3(d)/(e)), so a client's program, check-ins,
 * chat and bookings are part of it. A self-serve member (free or paying on the
 * web) and anyone whose tier isn't known get the free experience (3.1.1).
 */
export function digitalPaidAllowed(i: { native: boolean; staff: boolean; tier: "coaching" | "self_serve" | null | undefined }): boolean {
  return !i.native || i.staff || i.tier === "coaching";
}

/**
 * The access keys every free account gets (`member_access_defaults` for a JF
 * member, given by `member_free_join`): what a member keeps in the app. Any
 * other key (Premium `jf_premium`, `premium_member`, the paid plan bundles
 * such as `powerlifting_plans`) came with something paid.
 */
export const FREE_ACCESS_KEYS: readonly string[] = [
  "jf_membership",
  "app_membership",
  "program_library",
  "resource_library",
  "nutrition_tools",
  "community",
];
const FREE_KEYS = new Set(FREE_ACCESS_KEYS);

/** A member's access rows as the app may use them: only the free keys when paid digital access is off. */
export function accessForShell<T extends { access_level_key: string }>(rows: readonly T[], allowed: boolean): T[] {
  return allowed ? [...rows] : rows.filter((r) => FREE_KEYS.has(r.access_level_key));
}

/** A library plan a free account may open (any active member, or a free key). */
export function planOpenToFree(plan: { required_access_level?: string | null; audience_mode?: string | null }): boolean {
  return plan.audience_mode === "all_active" || FREE_KEYS.has(String(plan.required_access_level ?? "app_membership"));
}

type CreditLike = {
  unlimited: boolean;
  allowance_left: number | null;
  extra: number;
  left: number | null;
  history?: Array<{ kind: string }>;
  purchases?: unknown[];
};

/**
 * AI credits as the app shows them when paid digital access is off: the
 * month's free credits only. Credits bought (or added) on the web stay on the
 * account for the web and are never shown or spent in the app, and nothing
 * about buying (purchases, "Bought" lines) is listed.
 */
export function creditStateForShell<T extends CreditLike | null | undefined>(state: T, allowed: boolean): T {
  if (allowed || !state || state.unlimited) return state;
  const s: any = { ...state, extra: 0, left: Math.max(0, state.allowance_left ?? 0) };
  if (state.history) s.history = [];
  if (state.purchases) s.purchases = [];
  return s;
}

/** In the app with paid digital access off: an AI action is refused unless the month's free credits cover it. */
export function shellRefusesCreditSpend(state: Pick<CreditLike, "unlimited" | "allowance_left"> | null | undefined, cost: number, allowed: boolean): boolean {
  if (allowed || !state || state.unlimited) return false;
  return (state.allowance_left ?? 0) < cost;
}
