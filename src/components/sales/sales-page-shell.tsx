import { Link, useRouterState } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import type { ReactNode } from "react";

export function SalesPageShell({
  children,
  pageId,
  theme = "dark",
  floatingHeader = false,
  hideMarketingNav = false,
}: {
  children: ReactNode;
  pageId?: string;
  theme?: "light" | "dark";
  floatingHeader?: boolean;
  hideMarketingNav?: boolean;
}) {
  const themeClass = theme === "light" ? "theme-light" : "";
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isMembershipActive = pathname === "/membership" || pathname.startsWith("/join") || pathname.startsWith("/signup");
  const isCoachingActive = pathname.startsWith("/coaching");
  const navBtn =
    "px-2 sm:px-3 text-xs sm:text-sm transition-colors data-[active=true]:bg-primary data-[active=true]:text-primary-foreground data-[active=true]:font-bold data-[active=true]:shadow-sm";
  return (
    <div
      className={`min-h-screen bg-background text-foreground ${themeClass}`}
      data-page-id={pageId}
      data-theme={theme}
    >
      <header
        className={`fixed left-0 right-0 top-0 z-40 bg-background/85 backdrop-blur-md ${
          floatingHeader
            ? "mx-3 mt-3 rounded-2xl border border-border shadow-lg"
            : "border-b border-border"
        }`}
      >
        <div className="container mx-auto flex items-center justify-between gap-2 px-4 py-3">
          <Link to="/" className="text-base sm:text-lg font-black tracking-tight">JF Effect</Link>
          <nav className="flex items-center gap-1 sm:gap-2">
            {!hideMarketingNav && (
              <>
                <Link to="/membership" data-active={isMembershipActive ? "true" : undefined}>
                  <Button size="sm" variant="ghost" data-active={isMembershipActive ? "true" : undefined} className={navBtn}>
                    <span className="sm:hidden">Membership</span>
                    <span className="hidden sm:inline">Self-Guided Membership</span>
                  </Button>
                </Link>
                <Link to="/coaching" data-active={isCoachingActive ? "true" : undefined}>
                  <Button size="sm" variant="ghost" data-active={isCoachingActive ? "true" : undefined} className={navBtn}>
                    <span className="sm:hidden">Coaching</span>
                    <span className="hidden sm:inline">Private Coaching</span>
                  </Button>
                </Link>
              </>
            )}
            <Link to="/auth"><Button size="sm" variant="outline" className="px-2 sm:px-3 text-xs sm:text-sm">Sign In</Button></Link>
          </nav>
        </div>
      </header>
      <main className={floatingHeader ? "pt-20" : "pt-16"}>{children}</main>
      <footer className="border-t border-border mt-16 py-8 text-center text-xs text-muted-foreground">
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
      <h2 className="text-2xl md:text-4xl font-black tracking-tight">{title}</h2>
      {sub && <p className="mt-2 text-sm md:text-base text-muted-foreground">{sub}</p>}
    </div>
  );
}