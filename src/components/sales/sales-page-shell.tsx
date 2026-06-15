import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import type { ReactNode } from "react";

export function SalesPageShell({
  children,
  pageId,
  theme = "dark",
}: {
  children: ReactNode;
  pageId?: string;
  theme?: "light" | "dark";
}) {
  const themeClass = theme === "light" ? "theme-light" : "";
  return (
    <div
      className={`min-h-screen bg-background text-foreground ${themeClass}`}
      data-page-id={pageId}
      data-theme={theme}
    >
      <header className="sticky top-0 z-40 border-b border-border bg-background/90 backdrop-blur">
        <div className="container mx-auto flex items-center justify-between gap-2 px-4 py-3">
          <Link to="/" className="text-base sm:text-lg font-black tracking-tight">JF Effect</Link>
          <nav className="flex items-center gap-1 sm:gap-2">
            <Link
              to="/membership"
              activeProps={{ "data-active": "true" } as any}
            >
              <Button
                size="sm"
                variant="ghost"
                className="px-2 sm:px-3 text-xs sm:text-sm data-[active=true]:bg-primary/15 data-[active=true]:text-primary data-[active=true]:font-bold"
              >
                <span className="sm:hidden">Membership</span>
                <span className="hidden sm:inline">Self-Guided Membership</span>
              </Button>
            </Link>
            <Link
              to="/coaching"
              activeProps={{ "data-active": "true" } as any}
            >
              <Button
                size="sm"
                variant="ghost"
                className="px-2 sm:px-3 text-xs sm:text-sm data-[active=true]:bg-primary/15 data-[active=true]:text-primary data-[active=true]:font-bold"
              >
                <span className="sm:hidden">Coaching</span>
                <span className="hidden sm:inline">Private Coaching</span>
              </Button>
            </Link>
            <Link to="/auth"><Button size="sm" variant="outline" className="px-2 sm:px-3 text-xs sm:text-sm">Sign In</Button></Link>
          </nav>
        </div>
      </header>
      <main>{children}</main>
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