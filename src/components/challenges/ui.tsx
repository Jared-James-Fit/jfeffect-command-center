import { useEffect, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowRight, Dumbbell, Trophy, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { mediaUrl, track } from "@/lib/challenges/api";
import { STATUS_META, countdownText } from "@/lib/challenges/format";
import { initials } from "@/lib/challenges/share";
import type { ChallengeStatus } from "@/lib/challenges/types";

export function StatusPill({ status, className }: { status: ChallengeStatus; className?: string }) {
  const m = STATUS_META[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.12em]",
        m.tone === "live" && "bg-primary text-primary-foreground",
        m.tone === "neutral" && "bg-secondary text-foreground",
        m.tone === "done" && "bg-foreground text-background",
        m.tone === "warn" && "bg-warning/15 text-warning",
        m.tone === "muted" && "bg-muted text-muted-foreground",
        className,
      )}
    >
      {m.tone === "live" && (
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary-foreground/70 motion-reduce:hidden" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-primary-foreground" />
        </span>
      )}
      {m.label}
    </span>
  );
}

/** Ticks once a second under an hour, every 30s otherwise. */
export function useNow(fast: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), fast ? 1000 : 30_000);
    return () => clearInterval(id);
  }, [fast]);
  return now;
}

export function Countdown({ to, label, className }: { to: string; label: string; className?: string }) {
  const target = new Date(to).getTime();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const now = useNow(target - Date.now() < 3_600_000);
  if (!mounted) return null; // server and phone clocks differ: render on the phone only
  const left = target - now;
  if (left <= 0) return null;
  return (
    <div className={cn("flex items-baseline gap-2", className)}>
      <span className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{label}</span>
      <span className="font-display text-2xl tabular-nums leading-none">{countdownText(left)}</span>
    </div>
  );
}

export function AthleteAvatar({ name, photo, size = 40, className, ring }: { name: string; photo: string | null | undefined; size?: number; className?: string; ring?: boolean }) {
  const url = mediaUrl(photo);
  const [failed, setFailed] = useState(false);
  return (
    <span
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted font-display text-muted-foreground",
        ring && "ring-2 ring-primary ring-offset-2 ring-offset-background",
        className,
      )}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }}
      aria-hidden
    >
      {url && !failed ? (
        <img src={url} alt="" className="h-full w-full object-cover" loading="lazy" decoding="async" onError={() => setFailed(true)} />
      ) : (
        <span className="leading-none">{initials(name)}</span>
      )}
    </span>
  );
}

/** The thin bar over every public challenge page: the JF mark home, and sign in. */
export function PublicBar({ right, back }: { right?: ReactNode; back?: { to: string; label: string; params?: Record<string, string> } }) {
  const { user } = useAuth();
  return (
    <header className="sticky top-0 z-30 border-b border-border/60 bg-background pt-[env(safe-area-inset-top)]">
      <div className="mx-auto flex h-14 max-w-3xl items-center justify-between gap-3 px-4">
        <div className="flex min-w-0 items-center gap-2">
          {back ? (
            <Link
              to={back.to}
              params={back.params as never}
              className="inline-flex h-10 min-w-0 items-center gap-1 rounded-lg pr-2 text-sm font-semibold text-muted-foreground hover:text-foreground"
            >
              <span aria-hidden>‹</span>
              <span className="truncate">{back.label}</span>
            </Link>
          ) : (
            <Link to="/challenges" className="inline-flex h-10 items-center gap-2">
              <img src="/icon-192.png" alt="" className="h-8 w-8 rounded-lg" />
              <span className="text-[17px] font-bold uppercase italic tracking-[-0.03em]">JF Effect</span>
              <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground">Challenges</span>
            </Link>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {right}
          {!user && (
            <Link
              to="/auth"
              search={{ next: typeof window !== "undefined" ? window.location.pathname : undefined } as never}
              className="inline-flex h-10 items-center rounded-lg px-3 text-sm font-semibold text-muted-foreground hover:text-foreground"
            >
              Sign in
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}

/** The JF Effect invitation under every challenge: free app, not a hard sell. */
export function AppCta({ slug, variant = "card" }: { slug?: string | null; variant?: "card" | "compact" }) {
  const { user } = useAuth();
  if (user) return null;
  const points = [
    { icon: Dumbbell, text: "Free workouts written by a coach" },
    { icon: Trophy, text: "Build your own program and log every PR" },
    { icon: Users, text: "A crew of lifters who actually show up" },
  ];
  if (variant === "compact") {
    return (
      <Link
        to="/join"
        onClick={() => track(slug ?? null, "join_click")}
        className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-card p-4"
      >
        <div className="min-w-0">
          <div className="text-[15px] font-semibold">Train for the next one on JF Effect</div>
          <div className="text-sm text-muted-foreground">Free workouts, a workout builder and the crew.</div>
        </div>
        <span className="inline-flex h-10 shrink-0 items-center gap-1 rounded-lg bg-primary px-3 text-sm font-semibold text-primary-foreground">
          Try free <ArrowRight className="h-4 w-4" />
        </span>
      </Link>
    );
  }
  return (
    <section className="rounded-2xl border border-border bg-card p-5">
      <div className="flex items-center gap-3">
        <img src="/icon-192.png" alt="" className="h-11 w-11 rounded-xl" />
        <div>
          <h2 className="text-base font-semibold">Try the JF Effect app free</h2>
          <p className="text-sm text-muted-foreground">Get stronger for the next challenge, with the crew behind you.</p>
        </div>
      </div>
      <ul className="mt-4 space-y-2.5">
        {points.map(({ icon: Icon, text }) => (
          <li key={text} className="flex items-center gap-3 text-[15px]">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted">
              <Icon className="h-4 w-4" />
            </span>
            {text}
          </li>
        ))}
      </ul>
      <Link
        to="/join"
        onClick={() => track(slug ?? null, "join_click")}
        className="mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-primary text-[15px] font-semibold text-primary-foreground"
      >
        Join free <ArrowRight className="h-4 w-4" />
      </Link>
      <p className="mt-3 text-center text-xs text-muted-foreground">
        No card needed.{" "}
        <a
          href={`/coaching/apply?utm_source=challenge&utm_campaign=${encodeURIComponent(slug ?? "hub")}`}
          onClick={() => track(slug ?? null, "coaching_click")}
          className="font-semibold text-foreground underline-offset-2 hover:underline"
        >
          Want a coach? Apply for coaching
        </a>
      </p>
    </section>
  );
}

export function Section({ title, children, action, id }: { title: string; children: ReactNode; action?: ReactNode; id?: string }) {
  return (
    <section id={id} className="scroll-mt-20">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function PublicFooter() {
  return (
    <footer className="mx-auto max-w-3xl px-4 pb-[calc(2rem+env(safe-area-inset-bottom))] pt-10 text-center text-xs text-muted-foreground">
      Hosted by{" "}
      <Link to="/" className="font-semibold text-foreground">
        JF Effect
      </Link>
      {" · "}
      <Link to="/challenges" className="hover:text-foreground">
        All challenges
      </Link>
      {" · "}
      <Link to="/privacy" className="hover:text-foreground">
        Privacy
      </Link>
    </footer>
  );
}
