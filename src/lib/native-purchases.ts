/**
 * The iPhone app (the Capacitor shell, `isNative()` from "@/platform") never
 * sells, prices or points to a purchase: no buy button, no price, no plan
 * comparison, no sales page, and no link or redirect to a web checkout or a
 * sign-up that takes a payment (App Store guidelines 3.1.1 / 3.1.3; App
 * Review rejected build 35 for "subscription purchase link-out to Safari via
 * account registration"). A new person in the app can only apply for the free
 * account or sign in. Coaching (1:1, person-to-person, 3.1.3(d)) is paid
 * outside the app too, and the app never links there. Someone who already has
 * something (Premium, a plan, credits) uses it normally. What the app does for
 * paid digital tiers is Jared's decision: docs/APPLE_IAP_DECISION.md.
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
