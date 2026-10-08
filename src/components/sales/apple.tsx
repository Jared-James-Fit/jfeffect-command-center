import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { ChevronRight, Instagram, Youtube } from "lucide-react";
import { SOCIAL } from "@/lib/social-links";
import { cn } from "@/lib/utils";

/**
 * Public-page building blocks with the same calm, iOS-style language as the
 * sign-in screen: big semibold type, hairline-ringed grouped cards, one
 * obvious primary button, lots of air.
 */

/** A page section: consistent rhythm, optional soft tint, optional anchor id. */
export function Block({
  id,
  children,
  tint = false,
  narrow = false,
  className,
}: {
  id?: string;
  children: ReactNode;
  tint?: boolean;
  narrow?: boolean;
  className?: string;
}) {
  return (
    <section id={id} className={cn("scroll-mt-20", tint && "bg-muted/40")}>
      <div className={cn("mx-auto px-5 py-14 md:py-20", narrow ? "max-w-2xl" : "max-w-5xl", className)}>{children}</div>
    </section>
  );
}

/** Eyebrow + big title + one calm sentence. Left aligned on mobile, centred on desktop. */
export function Heading({
  eyebrow,
  title,
  sub,
  align = "center",
}: {
  eyebrow?: string;
  title: string;
  sub?: string;
  align?: "center" | "left";
}) {
  return (
    <div className={cn("mb-8 md:mb-10", align === "center" ? "mx-auto max-w-2xl text-center" : "max-w-2xl")}>
      {eyebrow && <div className="text-[13px] font-semibold text-primary">{eyebrow}</div>}
      <h2 className="mt-1.5 text-balance text-[28px] font-semibold leading-[1.12] tracking-[-0.02em] md:text-[40px]">{title}</h2>
      {sub && <p className="mt-3 text-[17px] leading-relaxed text-muted-foreground">{sub}</p>}
    </div>
  );
}

const PRIMARY =
  "inline-flex h-[54px] items-center justify-center gap-2 rounded-2xl bg-gradient-primary px-7 text-[17px] font-semibold text-primary-foreground shadow-[0_8px_24px_-10px_color-mix(in_oklab,var(--primary)_70%,transparent)] transition active:scale-[0.985] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

/** The one button per screen. Pass `to` for a route or `onClick` for an action. */
export function PrimaryCta({
  children,
  to,
  onClick,
  className,
  full = false,
}: {
  children: ReactNode;
  to?: string;
  onClick?: () => void;
  className?: string;
  full?: boolean;
}) {
  const cls = cn(PRIMARY, full && "w-full", className);
  if (to) {
    return (
      <Link to={to as any} className={cls}>
        {children}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} className={cls}>
      {children}
    </button>
  );
}

/** Quiet text link with a chevron — the "secondary" action. */
export function TextLink({ children, to, href }: { children: ReactNode; to?: string; href?: string }) {
  const cls =
    "inline-flex items-center justify-center gap-0.5 text-[17px] font-medium text-primary transition active:opacity-60 hover:underline underline-offset-4";
  if (href) {
    return (
      <a href={href} className={cls}>
        {children}
        <ChevronRight className="h-4 w-4" aria-hidden />
      </a>
    );
  }
  return (
    <Link to={(to ?? "/") as any} className={cls}>
      {children}
      <ChevronRight className="h-4 w-4" aria-hidden />
    </Link>
  );
}

/** iOS grouped card: one rounded surface, rows separated by hairlines. */
export function Group({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("overflow-hidden rounded-2xl bg-card ring-1 ring-border/70 divide-y divide-border/70", className)}>
      {children}
    </div>
  );
}

/** Standalone rounded surface (no dividers). */
export function Surface({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("rounded-2xl bg-card ring-1 ring-border/70", className)}>{children}</div>;
}

/** Soft icon tile used in lists. */
export function IconTile({ children }: { children: ReactNode }) {
  return (
    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[11px] bg-primary/10 text-primary">{children}</span>
  );
}

/** Edge-to-edge horizontal scroller with snap points (swipe on phones). */
export function Rail({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div
      role="region"
      aria-label={label}
      tabIndex={0}
      className="-mx-5 flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-px-5 px-5 pb-3 [-webkit-overflow-scrolling:touch] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {children}
    </div>
  );
}

/** Small stat used in quiet number rows. */
export function Stat({ value, label, detail }: { value: string; label: string; detail?: string }) {
  return (
    <div className="px-4 py-5 text-center">
      <div className="text-[28px] font-semibold leading-none tracking-[-0.02em] text-primary md:text-[34px]">{value}</div>
      <div className="mt-2 text-[13px] font-semibold">{label}</div>
      {detail && <div className="mt-1 text-[12px] leading-snug text-muted-foreground">{detail}</div>}
    </div>
  );
}

/**
 * Instagram + YouTube. "pills" shows the handle (for body sections),
 * "icons" is the compact version for the footer.
 */
export function SocialLinks({ variant = "pills", className }: { variant?: "pills" | "icons"; className?: string }) {
  const items = [
    { ...SOCIAL.instagram, Icon: Instagram },
    { ...SOCIAL.youtube, Icon: Youtube },
  ];
  return (
    <div className={cn("flex flex-wrap items-center gap-2.5", variant === "icons" && "justify-center", className)}>
      {items.map(({ label, handle, url, Icon }) => (
        <a
          key={label}
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`${label} ${handle}`}
          className={cn(
            "inline-flex items-center gap-2 rounded-full bg-muted font-medium text-foreground transition active:scale-[0.97] hover:bg-muted/70",
            variant === "pills" ? "h-11 px-4 text-[15px]" : "h-10 w-10 justify-center",
          )}
        >
          <Icon className="h-[18px] w-[18px]" aria-hidden />
          {variant === "pills" && <span>{handle}</span>}
        </a>
      ))}
    </div>
  );
}
