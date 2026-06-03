import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "JF Effect — Coaching Command Center" },
      { name: "description", content: "The private operating system for JF Effect coaching — clients, programs, payments, check-ins, all in one place." },
      { property: "og:title", content: "JF Effect — Coaching Command Center" },
      { property: "og:description", content: "The private operating system for JF Effect coaching." },
    ],
  }),
  component: Landing,
});

function Landing() {
  const { user, role, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (loading) return;
    if (user && role) {
      navigate({ to: role === "admin" ? "/admin" : "/portal", replace: true });
    }
  }, [user, role, loading, navigate]);

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_top,oklch(0.62_0.22_25/0.15),transparent_55%)]" />
      <nav className="flex items-center justify-between px-6 py-5 md:px-12">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-full bg-gradient-primary text-sm font-black text-primary-foreground shadow-glow">JF</div>
          <span className="font-black tracking-tight">JF EFFECT</span>
        </div>
        <Link to="/auth">
          <Button variant="default" className="bg-gradient-primary font-bold tracking-wide uppercase">Sign in</Button>
        </Link>
      </nav>

      <section className="mx-auto max-w-5xl px-6 pt-20 pb-32 text-center md:pt-32">
        <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-border bg-card/60 px-4 py-1.5 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          <span className="h-1.5 w-1.5 rounded-full bg-primary" /> Private coaching OS
        </div>
        <h1 className="text-balance text-5xl font-black tracking-tight md:text-7xl">
          One command center for <span className="bg-gradient-primary bg-clip-text text-transparent">every client</span>, program, and payment.
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-pretty text-lg text-muted-foreground md:text-xl">
          JF Effect is the private operating system for high-performance coaching. Manage leads, clients, programs, offers and resources without leaving the dashboard.
        </p>
        <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
          <Link to="/auth">
            <Button size="lg" className="bg-gradient-primary font-bold tracking-wide uppercase shadow-glow">
              Enter dashboard <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </Link>
        </div>
        <div className="mx-auto mt-20 grid max-w-3xl grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border md:grid-cols-4">
          {[
            ["100%", "Online + In-Person"],
            ["1:1", "Private coaching"],
            ["LIVE", "Check-in tracking"],
            ["JF", "Effect verified"],
          ].map(([k, v]) => (
            <div key={v} className="bg-card px-6 py-8 text-left">
              <div className="text-2xl font-black">{k}</div>
              <div className="mt-1 text-xs uppercase tracking-widest text-muted-foreground">{v}</div>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
