import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { SocialLinks } from "@/components/sales/apple";
import { PublicHeader } from "@/components/sales/public-header";
import type { CtaChoice } from "@/lib/sticky-cta";
import { blockMediaSave } from "@/lib/protect-media";

/**
 * Every public page's frame: the one header (public-header.tsx, its links and
 * button from public-nav.ts), the page, and the footer. Its photos can't be
 * saved from the page (protect-media.ts).
 */
export function SalesPageShell({
  children,
  pageId,
  theme = "dark",
  floatingHeader = false,
  hideMarketingNav = false,
  cta,
  ctaZones,
}: {
  children: ReactNode;
  pageId?: string;
  theme?: "light" | "dark";
  floatingHeader?: boolean;
  /** An application in progress: the header is the logo and Sign in only. */
  hideMarketingNav?: boolean;
  /** The header's button; left out = the page's own (`headerCtaFor`), null = none. */
  cta?: CtaChoice | null;
  /** Sections whose button is different while they're on screen (`data-cta-zone`). */
  ctaZones?: Record<string, CtaChoice>;
}) {
  const themeClass = theme === "light" ? "theme-light" : "";
  return (
    <div
      className={`min-h-screen bg-background text-foreground ${themeClass}`}
      data-page-id={pageId}
      data-theme={theme}
      data-protect-media
      onContextMenu={blockMediaSave}
      onDragStart={blockMediaSave}
    >
      <PublicHeader
        cta={cta}
        ctaZones={ctaZones}
        focused={hideMarketingNav}
        floating={floatingHeader}
      />
      <main
        style={{ paddingTop: floatingHeader ? "calc(env(safe-area-inset-top) + 5rem)" : "calc(env(safe-area-inset-top) + 3.5rem)" }}
      >
        {children}
      </main>
      <footer className="mt-8 border-t border-border/70 px-5 py-10 text-center text-[13px] text-muted-foreground">
        {/* data-web-only: the iPhone app links to no sales page (native-purchases.ts) */}
        <nav aria-label="Footer" className="mb-3 flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
          <Link to="/" className="hover:text-foreground">Home</Link>
          <Link to="/" hash="app" className="hover:text-foreground" data-web-only>Free app</Link>
          <Link to="/coaching" className="hover:text-foreground" data-web-only>Online coaching</Link>
          <Link to="/about" className="hover:text-foreground" data-web-only>About</Link>
          <Link to="/auth" className="hover:text-foreground">Sign in</Link>
          <Link to="/support" className="hover:text-foreground">Support</Link>
          <Link to="/privacy" className="hover:text-foreground">Privacy</Link>
          <Link to="/terms" className="hover:text-foreground">Terms</Link>
        </nav>
        <SocialLinks variant="icons" className="mb-4" />
        © {new Date().getFullYear()} JF Effect. All rights reserved.
      </footer>
    </div>
  );
}

export function Section({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <section className={`container mx-auto px-4 py-12 md:py-16 ${className}`}>
      {children}
    </section>
  );
}

export function SectionTitle({ eyebrow, title, sub }: { eyebrow?: string; title: string; sub?: string }) {
  return (
    <div className="mx-auto max-w-2xl text-center mb-8">
      {eyebrow && <div className="text-xs font-bold uppercase tracking-widest text-primary mb-2">{eyebrow}</div>}
      <h2 className="text-2xl md:text-4xl font-bold tracking-tight">{title}</h2>
      {sub && <p className="mt-2 text-sm md:text-base text-muted-foreground">{sub}</p>}
    </div>
  );
}