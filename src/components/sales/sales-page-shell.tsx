import { Link, useRouterState } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import type { ReactNode } from "react";
import { SocialLinks } from "@/components/sales/apple";

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
  const navButtonClass = "px-2.5 text-[14px] font-medium text-muted-foreground transition-colors hover:text-foreground sm:px-3 sm:text-[15px]";
  const activeNavClass = "bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary";
  return (
    <div
      className={`min-h-screen bg-background text-foreground ${themeClass}`}
      data-page-id={pageId}
      data-theme={theme}
    >
      <header
        className={`fixed left-0 right-0 top-0 z-40 bg-background/80 backdrop-blur-xl backdrop-saturate-150 ${
          floatingHeader
            ? "mx-3 mt-3 rounded-2xl ring-1 ring-border/70 shadow-[0_8px_30px_-12px_rgba(0,0,0,0.18)]"
            : "border-b border-border/70"
        }`}
        style={floatingHeader ? undefined : { paddingTop: "env(safe-area-inset-top)" }}
      >
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-2 px-4 py-2.5">
          <Link to="/" className="text-[17px] font-semibold tracking-[-0.01em]">JF Effect</Link>
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
                className={`rounded-full px-3.5 text-[14px] font-medium transition-colors sm:text-[15px] ${isAuth ? "shadow-sm" : ""}`}
              >
                Sign In
              </Button>
            </Link>
          </nav>
        </div>
      </header>
      <main className={floatingHeader ? "pt-20" : "pt-16"}>{children}</main>
      <footer className="mt-8 border-t border-border/70 px-5 py-10 text-center text-[13px] text-muted-foreground">
        <nav aria-label="Footer" className="mb-3 flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
          <Link to="/coaching" className="hover:text-foreground">Coaching</Link>
          <Link to="/about" className="hover:text-foreground">About</Link>
          <Link to="/auth" className="hover:text-foreground">Sign in</Link>
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
      <h2 className="text-2xl md:text-4xl font-black tracking-tight">{title}</h2>
      {sub && <p className="mt-2 text-sm md:text-base text-muted-foreground">{sub}</p>}
    </div>
  );
}