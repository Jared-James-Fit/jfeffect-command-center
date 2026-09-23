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
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const isCoaching = pathname === "/coaching" || pathname.startsWith("/coaching/");
  const isAbout = pathname === "/about" || pathname.startsWith("/about/");
  const isAuth = pathname === "/auth" || pathname.startsWith("/auth/");
  const navButtonClass = "relative px-2 text-xs transition-colors sm:px-3 sm:text-sm";
  const activeNavClass = "bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary after:absolute after:inset-x-2 after:-bottom-[13px] after:h-0.5 after:rounded-full after:bg-primary sm:after:inset-x-3";
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
                <Link to="/coaching" aria-current={isCoaching ? "page" : undefined}>
                  <Button
                    size="sm"
                    variant="ghost"
                    className={`${navButtonClass} ${isCoaching ? activeNavClass : ""}`}
                  >
                    Coaching
                  </Button>
                </Link>
                <Link to="/about" aria-current={isAbout ? "page" : undefined}>
                  <Button
                    size="sm"
                    variant="ghost"
                    className={`${navButtonClass} ${isAbout ? activeNavClass : ""}`}
                  >
                    About
                  </Button>
                </Link>
              </>
            )}
            <Link to="/auth" aria-current={isAuth ? "page" : undefined}>
              <Button
                size="sm"
                variant={isAuth ? "default" : "outline"}
                className={`px-2 text-xs transition-colors sm:px-3 sm:text-sm ${isAuth ? "shadow-sm" : ""}`}
              >
                Sign In
              </Button>
            </Link>
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