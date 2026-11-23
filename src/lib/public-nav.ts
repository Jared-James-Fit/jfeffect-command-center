/**
 * The public site's navigation (jfeffect.com signed out), one list for the
 * header, the phone menu and the footer (pure, tested in public-nav.test.ts).
 *
 * The site sells two things and the nav says so: the Free app (the home
 * page's app section, then /join) and Online coaching (/coaching, then
 * /coaching/apply), and Pricing puts every option side by side (the home
 * page's #pricing, so nobody has to go through /coaching to compare). Home is
 * the logo and the first row of the phone menu; About sits last. The header's one button is the page's own ask: Get the free app
 * where the app is the point, Apply for coaching where coaching is, and on
 * the home page it follows what's on screen (the coaching section asks for
 * the application, never the free app beside it). The application flows
 * themselves get a quiet header: the logo and Sign in, nothing else to tap.
 */
import type { CtaChoice } from "@/lib/sticky-cta";

export type PublicNavKey = "home" | "app" | "coaching" | "pricing" | "about";

export type PublicNavItem = {
  key: PublicNavKey;
  label: string;
  /** The route, and the section of it when there is one. */
  to: "/" | "/coaching" | "/about";
  hash?: string;
  /** One line under it in the phone menu: what it is, free or paid. */
  hint: string;
};

export const PUBLIC_NAV: PublicNavItem[] = [
  { key: "home", label: "Home", to: "/", hint: "JF Effect" },
  {
    key: "app",
    label: "Free app",
    to: "/",
    hash: "app",
    hint: "Programs, logging and the Crew. Free to use.",
  },
  {
    key: "coaching",
    label: "Online coaching",
    to: "/coaching",
    hint: "1:1 coaching with me. Paid, by application.",
  },
  {
    key: "pricing",
    label: "Pricing",
    to: "/",
    hash: "pricing",
    hint: "The free app and every coaching package, side by side.",
  },
  { key: "about", label: "About", to: "/about", hint: "Who I am and what I've done." },
];

export const JOIN_CHOICE: CtaChoice = { label: "Get the free app", href: "/join" };
export const APPLY_CHOICE: CtaChoice = { label: "Apply for coaching", href: "/coaching/apply" };

/** Which row is lit: the page you're on (the app's application lights Free app). */
export function activeNavKey(pathname: string, hash = ""): PublicNavKey | null {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === "/") {
    const h = hash.replace(/^#/, "");
    return h === "app" ? "app" : h === "pricing" ? "pricing" : "home";
  }
  if (path === "/join" || path.startsWith("/join/")) return "app";
  if (path === "/coaching" || path.startsWith("/coaching/")) return "coaching";
  if (path === "/about" || path.startsWith("/about/")) return "about";
  return null;
}

/**
 * What the logo (and Home) does on a plain tap: on the home page, back to the
 * top (and off any #pricing / #app, so Home lights again); anywhere else, the
 * home page, which opens at its top.
 */
export function homeTapAction(pathname: string): "top" | "home" {
  const path = pathname.replace(/\/+$/, "") || "/";
  return path === "/" ? "top" : "home";
}

/** The header's button for a page: the app's ask, coaching's, or none (an application in progress). */
export function headerCtaFor(pathname: string): CtaChoice | null {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === "/") return JOIN_CHOICE;
  if (path === "/coaching" || path === "/about") return APPLY_CHOICE;
  return null;
}

/** On the home page, the coaching section asks for the application. */
export const HOME_CTA_ZONES: Record<string, CtaChoice> = { coaching: APPLY_CHOICE };
