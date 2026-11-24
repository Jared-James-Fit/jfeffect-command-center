import { Suspense, useEffect, useRef, useState, type MouseEvent } from "react";
import { Link, useRouter, useRouterState } from "@tanstack/react-router";
import { Menu } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  PUBLIC_NAV,
  activeNavKey,
  headerCtaFor,
  homeTapAction,
  type PublicNavItem,
} from "@/lib/public-nav";
import type { CtaChoice } from "@/lib/sticky-cta";
import { useCtaZone } from "@/components/sales/use-cta-zone";
import { lazyWithRetry } from "@/lib/lazy-chunk";
import { runWhenIdle } from "@/lib/idle";
// 96 px, hashed (cached for a year): the 512 px /logo.png went out uncached for a 26–32 px mark
import logoSmall from "@/assets/brand/logo-96.webp";

const PublicMenuSheet = lazyWithRetry(() => import("@/components/sales/public-menu"));

/**
 * The public site's one header (public-nav.ts): the JF Effect logo is Home,
 * then Home · Free app · Online coaching · About and a quiet Sign in on a
 * computer, the page's one button (red) on a tablet or computer, and a menu
 * on a phone, where the page's own buttons and the bottom bar carry the ask.
 * `focused` (an application in progress) is the logo and Sign in only.
 */
export function PublicHeader({
  cta,
  ctaZones,
  focused = false,
  floating = false,
}: {
  /** The page's button; undefined = the page's default (`headerCtaFor`), null = none. */
  cta?: CtaChoice | null;
  /** Sections that ask for something else while they're on screen. */
  ctaZones?: Record<string, CtaChoice>;
  focused?: boolean;
  floating?: boolean;
}) {
  const { pathname, hash } = useRouterState({
    select: (s) => ({ pathname: s.location.pathname, hash: s.location.hash }),
  });
  const active = activeNavKey(pathname, hash);
  const zone = useCtaZone(!focused && !!ctaZones);
  const base = cta === undefined ? headerCtaFor(pathname) : cta;
  const choice = focused ? null : (zone && ctaZones?.[zone]) || base;
  const [open, setOpen] = useState(false);

  // a new page or section closes the phone menu
  useEffect(() => setOpen(false), [pathname, hash]);

  return (
    <header
      className={cn(
        "fixed left-0 right-0 top-0 z-40 bg-background",
        floating ? "px-3 pt-3" : "border-b border-border/70",
      )}
      style={{
        paddingTop: floating
          ? "calc(env(safe-area-inset-top) + 0.75rem)"
          : "env(safe-area-inset-top)",
      }}
      data-public-header={focused ? "focused" : "full"}
    >
      <div
        className={cn(
          // three columns, so the links stay centred when the button's words change
          "mx-auto grid h-14 max-w-5xl grid-cols-[1fr_auto_1fr] items-center gap-3 px-4",
          floating && "rounded-2xl bg-background ring-1 ring-border/70",
        )}
      >
        <BrandLink />

        {!focused && (
          <nav aria-label="Main" className="hidden items-center gap-1 lg:flex" data-public-nav>
            {PUBLIC_NAV.map((item) => (
              <NavLink key={item.key} item={item} active={active === item.key} />
            ))}
          </nav>
        )}

        <div className="col-start-3 flex items-center justify-end gap-1.5">
          <Link
            to="/auth"
            className={cn(
              "h-10 items-center whitespace-nowrap rounded-full px-3 text-[15px] font-medium text-muted-foreground transition-colors hover:text-foreground",
              focused ? "inline-flex" : "hidden lg:inline-flex",
            )}
          >
            Sign in
          </Link>
          {choice && (
            <CtaLink
              choice={choice}
              className="hidden h-10 px-4 text-[15px] md:inline-flex"
              data-nav-cta={choice.href}
            />
          )}
          {!focused && (
            <PhoneMenu open={open} onOpenChange={setOpen} active={active} choice={choice} />
          )}
        </div>
      </div>
    </header>
  );
}

/**
 * The logo and Home on a plain tap (homeTapAction): on the home page, glide
 * back to the top (a jump with reduced motion) and drop any #pricing / #app
 * from the address so Home lights again; anywhere else, the link goes home and
 * the page opens at its top. A link to the page you're on never scrolls by
 * itself here (the router's scroll restoration put it back where it was), so
 * the home page's tap is handled before the link navigates. A Cmd, Ctrl,
 * Shift or middle click stays the browser's (a new tab or window). `onDone`
 * closes the phone menu either way.
 */
export function useHomeTap(onDone?: () => void) {
  const router = useRouter();
  return (e: MouseEvent<HTMLAnchorElement>) => {
    onDone?.();
    if (typeof window === "undefined" || e.defaultPrevented) return;
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (homeTapAction(window.location.pathname) !== "top") return;
    e.preventDefault();
    const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const toTop = () => window.scrollTo({ top: 0, left: 0, behavior: still ? "auto" : "smooth" });
    if (window.location.hash) {
      void router.navigate({ to: "/", replace: true, resetScroll: false }).then(toTop, toTop);
    } else {
      toTop();
    }
  };
}

export function BrandLink({ onDone }: { onDone?: () => void }) {
  const onTap = useHomeTap(onDone);
  return (
    <Link
      to="/"
      onClick={onTap}
      aria-label="JF Effect home"
      activeProps={{}}
      className="-ml-1 flex min-h-11 w-fit items-center gap-2 rounded-lg px-1 text-[17px] font-semibold tracking-[-0.01em] transition-opacity active:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      data-brand-home
    >
      <img
        src={logoSmall}
        alt=""
        width={28}
        height={28}
        decoding="async"
        className="h-7 w-7 rounded-[7px]"
        draggable={false}
      />
      <span>JF Effect</span>
    </Link>
  );
}

/**
 * Where a row goes. Home and Free app are both "/", so the router only calls
 * them active on that exact address and hash (it adds aria-current to an
 * active link whatever it's told); which row is lit is `activeNavKey`'s.
 */
export function navTarget(item: PublicNavItem) {
  const exact = item.to === "/" ? { activeOptions: { exact: true, includeHash: true } } : {};
  return item.hash ? { to: item.to, hash: item.hash, ...exact } : { to: item.to, ...exact };
}

function NavLink({ item, active }: { item: PublicNavItem; active: boolean }) {
  const homeTap = useHomeTap();
  return (
    <Link
      {...(navTarget(item) as any)}
      onClick={item.key === "home" ? homeTap : undefined}
      activeProps={{}}
      aria-current={active ? "page" : undefined}
      className={cn(
        // one line whatever font loads: a wider fallback font once wrapped words onto two lines
        "inline-flex h-10 items-center whitespace-nowrap rounded-full px-3 text-[15px] font-medium transition-colors xl:px-3.5",
        active ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground",
      )}
      data-nav-link={item.key}
    >
      {item.label}
    </Link>
  );
}

export function CtaLink({
  choice,
  className,
  ...rest
}: {
  choice: CtaChoice;
  className?: string;
  [key: `data-${string}`]: string;
}) {
  const cls = cn(
    "items-center justify-center whitespace-nowrap rounded-full bg-primary font-semibold text-primary-foreground transition active:scale-[0.985] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
    className,
  );
  return (
    <Link to={choice.href as any} className={cls} {...rest}>
      {choice.label}
    </Link>
  );
}

function PhoneMenu({
  open,
  onOpenChange,
  active,
  choice,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  active: string | null;
  choice: CtaChoice | null;
}) {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  // mounted on the first open, then kept (so it can animate closed)
  const [used, setUsed] = useState(false);
  if (open && !used) setUsed(true);
  useEffect(() => runWhenIdle(() => void PublicMenuSheet.preload(), { after: 3000 }), []);
  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onPointerDown={() => void PublicMenuSheet.preload()}
        onClick={() => onOpenChange(true)}
        className="-mr-2 inline-flex h-11 w-11 items-center justify-center rounded-full text-foreground transition hover:bg-secondary active:scale-95 lg:hidden"
        aria-label="Menu"
        aria-haspopup="dialog"
        aria-expanded={open}
        data-nav-menu
      >
        <Menu className="h-[22px] w-[22px]" aria-hidden />
      </button>
      {used && (
        <Suspense fallback={null}>
          <PublicMenuSheet open={open} onOpenChange={onOpenChange} active={active} choice={choice} returnFocusTo={triggerRef} />
        </Suspense>
      )}
    </>
  );
}
