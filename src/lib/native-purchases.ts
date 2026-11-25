/**
 * Premium and every other digital product are sold on the web only (Jared's
 * decision, Nov 25 2026; App Store guideline 3.1.1 / 3.1.3). The iPhone app
 * (the Capacitor shell, `isNative()` from "@/platform") never shows a purchase
 * button, a price or a link to buy one, and never says where else to buy.
 * Someone who already has it (Premium, a paid plan, credits) uses it normally.
 *
 * Pure and tested in native-purchases.test.ts. Every surface that could sell
 * or promote something asks here instead of keeping its own list.
 */

/** What the app says when a purchase is refused in the shell: no pointer to the web. */
export const NATIVE_PURCHASE_BLOCKED = "Not available in the app";

/** Where something is bought or its price is shown: never linked to from the iPhone app. */
const BUY_PATH = /^\/(?:premium|membership|coaching|join|pay|autopay|checkout|buy|upgrade|pricing|credits|portal\/(?:plan|upgrade|membership|credits))(?:[/?#]|$)/i;

export function isBuyPath(path: string | null | undefined): boolean {
  return !!path && BUY_PATH.test(path);
}

/** A Crew promo that points at something to buy is for the web app only. */
export function promosForShell<T extends { cta_path: string }>(promos: readonly T[], native: boolean): T[] {
  return native ? promos.filter((p) => !isBuyPath(p.cta_path)) : [...promos];
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
