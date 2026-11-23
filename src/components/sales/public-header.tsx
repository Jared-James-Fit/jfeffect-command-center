import { useEffect, useState, type MouseEvent } from "react";
import { Link, useRouter, useRouterState } from "@tanstack/react-router";
import * as Dialog from "@radix-ui/react-dialog";
import { ChevronRight, Menu, X } from "lucide-react";
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
// 96 px, hashed (cached for a year): the 512 px /logo.png went out uncached for a 26–32 px mark
import logoSmall from "@/assets/brand/logo-96.webp";

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
function useHomeTap(onDone?: () => void) {
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

function BrandLink({ onDone }: { onDone?: () => void }) {
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
function navTarget(item: PublicNavItem) {
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

function CtaLink({
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
  const homeTap = useHomeTap(() => onOpenChange(false));
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Trigger
        className="-mr-2 inline-flex h-11 w-11 items-center justify-center rounded-full text-foreground transition hover:bg-secondary lg:hidden"
        aria-label="Menu"
        data-nav-menu
      >
        <Menu className="h-[22px] w-[22px]" aria-hidden />
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 lg:hidden" />
        <Dialog.Content
          className="fixed inset-x-0 top-0 z-50 max-h-[100dvh] overflow-y-auto rounded-b-3xl bg-background pb-[calc(env(safe-area-inset-bottom)+1.25rem)] shadow-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-top data-[state=open]:slide-in-from-top data-[state=closed]:duration-200 data-[state=open]:duration-300 focus:outline-none lg:hidden"
          style={{ paddingTop: "env(safe-area-inset-top)" }}
          data-public-menu
          aria-describedby={undefined}
        >
          <Dialog.Title className="sr-only">Menu</Dialog.Title>
          <div className="mx-auto max-w-lg px-4">
            <div className="flex h-14 items-center justify-between">
              <BrandLink onDone={() => onOpenChange(false)} />
              <Dialog.Close
                className="-mr-2 inline-flex h-11 w-11 items-center justify-center rounded-full transition hover:bg-secondary"
                aria-label="Close menu"
              >
                <X className="h-[22px] w-[22px]" aria-hidden />
              </Dialog.Close>
            </div>

            <nav aria-label="Main" className="mt-2 divide-y divide-border/70">
              {PUBLIC_NAV.map((item) => {
                const close = () => onOpenChange(false);
                const on = active === item.key;
                return (
                  <Link
                    key={item.key}
                    {...(navTarget(item) as any)}
                    onClick={item.key === "home" ? homeTap : close}
                    activeProps={{}}
                    aria-current={on ? "page" : undefined}
                    className="flex min-h-[64px] items-center justify-between gap-4 py-3"
                    data-menu-link={item.key}
                  >
                    <span className="min-w-0">
                      <span
                        className={cn(
                          "block text-[20px] font-semibold leading-tight tracking-[-0.01em]",
                          !on && "text-foreground/85",
                        )}
                      >
                        {item.label}
                      </span>
                      {item.key !== "home" && (
                        <span className="mt-0.5 block text-[14px] leading-snug text-muted-foreground">
                          {item.hint}
                        </span>
                      )}
                    </span>
                    {on ? (
                      <span className="h-2 w-2 shrink-0 rounded-full bg-foreground" aria-hidden />
                    ) : (
                      <ChevronRight
                        className="h-5 w-5 shrink-0 text-muted-foreground"
                        aria-hidden
                      />
                    )}
                  </Link>
                );
              })}
            </nav>

            <div className="mt-6 space-y-3">
              {choice && (
                <CtaLink
                  choice={choice}
                  className="flex h-[54px] w-full rounded-2xl text-[17px]"
                  data-menu-cta={choice.href}
                />
              )}
              <Link
                to="/auth"
                onClick={() => onOpenChange(false)}
                className="flex h-12 w-full items-center justify-center rounded-2xl text-[16px] font-medium text-muted-foreground transition hover:text-foreground"
                data-menu-signin
              >
                Already a member?{" "}
                <span className="ml-1 font-semibold text-foreground">Sign in</span>
              </Link>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
