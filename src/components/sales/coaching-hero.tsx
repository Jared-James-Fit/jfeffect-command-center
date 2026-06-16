import { Button } from "@/components/ui/button";
import type { ReactNode } from "react";
import { MessageCircle, Dumbbell, ClipboardCheck, TrendingUp } from "lucide-react";

export function CoachingHero({
  eyebrow, headline, sub, primary, secondary,
}: {
  eyebrow?: string;
  headline: string;
  sub: string;
  primary: ReactNode;
  secondary?: ReactNode;
  /** @deprecated kept for backward compatibility — no longer rendered */
  image?: string | null;
}) {
  return (
    <section className="relative isolate overflow-hidden border-b border-white/10 bg-[#0a0a0a] text-white">
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_18%_30%,_color-mix(in_oklab,var(--primary)_22%,transparent),transparent_55%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_85%_75%,_color-mix(in_oklab,var(--primary)_14%,transparent),transparent_60%)]" />
        <div className="absolute inset-0 opacity-[0.04] mix-blend-overlay [background-image:radial-gradient(circle_at_1px_1px,#fff_1px,transparent_0)] [background-size:3px_3px]" />
      </div>

      <div className="container mx-auto grid gap-12 px-4 py-20 md:py-28 lg:grid-cols-[1.05fr_1fr] lg:items-center">
        <div className="relative">
          {eyebrow && (
            <div className="inline-flex items-center gap-2 rounded-full border border-primary/50 bg-primary/15 px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.18em] text-primary">
              <span className="h-1.5 w-1.5 rounded-full bg-primary" />
              {eyebrow}
            </div>
          )}
          <h1 className="mt-6 max-w-[22ch] text-4xl font-black leading-[1.02] tracking-tight md:text-6xl lg:text-[4.25rem]">
            {headline}
          </h1>
          <p className="mt-5 max-w-xl text-base text-white/75 md:text-lg">{sub}</p>

          <div className="mt-8 flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:gap-5">
            {primary}
            {secondary}
          </div>
          <p className="mt-4 text-[11px] uppercase tracking-[0.22em] text-white/55">
            Application required · Limited client capacity
          </p>
        </div>

        <div className="relative mx-auto w-full max-w-[420px] lg:max-w-none">
          <CoachingAppPreview />
        </div>
      </div>
    </section>
  );
}

function CoachingAppPreview() {
  return (
    <div className="relative mx-auto aspect-[9/19] w-[260px] rounded-[2.4rem] border border-white/[0.08] bg-gradient-to-b from-[#1A1E27] via-[#0d0f13] to-[#000] p-[6px] shadow-[0_40px_90px_-20px_rgba(0,0,0,0.85),0_0_0_1px_rgba(255,255,255,0.04)_inset] md:w-[300px]">
      <div className="absolute inset-[6px] rounded-[2.05rem] ring-1 ring-white/[0.04]" />
      <div className="absolute left-1/2 top-[10px] z-10 h-5 w-24 -translate-x-1/2 rounded-b-2xl bg-black" />
      <div className="relative h-full w-full overflow-hidden rounded-[2rem] bg-[#0A0B0E] text-white">
        <div className="flex h-full w-full flex-col">
          <div className="px-4 pb-2 pt-8">
            <div className="text-[10px] font-bold uppercase tracking-widest text-[#7E848F]">JF Effect · Coaching</div>
            <div className="mt-1 text-lg font-black leading-tight">Welcome back</div>
            <div className="text-[11px] text-[#B0B4BE]">Block 2 · Week 3</div>
          </div>

          <div className="mx-3 mt-2 rounded-2xl border border-primary/40 bg-gradient-to-br from-primary/25 to-primary/5 p-3">
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-primary">
              <MessageCircle className="h-3 w-3" /> Message from Jared
            </div>
            <div className="mt-1.5 text-[11px] leading-snug text-white/90">
              Reviewed your check-in — pushing top set Wed to RPE 7. Calories hold.
            </div>
          </div>

          <div className="mx-3 mt-3 rounded-2xl border border-white/[0.08] bg-[#11141B] p-3">
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-[#7E848F]">
              <Dumbbell className="h-3 w-3 text-primary" /> Today
            </div>
            <div className="mt-1 text-[13px] font-bold">Upper · Push focus</div>
            <div className="mt-0.5 text-[10px] text-[#B0B4BE]">5 lifts · 42 min · RPE 7</div>
            <div className="mt-2 flex gap-1">
              <span className="rounded-full bg-primary/20 px-2 py-0.5 text-[9px] font-semibold text-primary">Bench</span>
              <span className="rounded-full bg-white/10 px-2 py-0.5 text-[9px] font-semibold text-white/85">OHP</span>
              <span className="rounded-full bg-white/10 px-2 py-0.5 text-[9px] font-semibold text-white/85">Dips</span>
            </div>
          </div>

          <div className="mx-3 mt-3 grid grid-cols-2 gap-2">
            <div className="rounded-2xl border border-white/[0.08] bg-[#11141B] p-2.5">
              <div className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-widest text-[#7E848F]">
                <ClipboardCheck className="h-3 w-3 text-primary" /> Check-in
              </div>
              <div className="mt-1 text-[11px] font-bold">Due Sunday</div>
              <div className="text-[9px] text-[#B0B4BE]">3 photos · weight</div>
            </div>
            <div className="rounded-2xl border border-white/[0.08] bg-[#11141B] p-2.5">
              <div className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-widest text-[#7E848F]">
                <TrendingUp className="h-3 w-3 text-primary" /> Bench
              </div>
              <div className="mt-1 text-[11px] font-bold">+12 lb</div>
              <div className="flex h-5 items-end gap-0.5">
                {[35, 48, 42, 58, 64, 60, 72].map((h, i) => (
                  <div key={i} className="flex-1 rounded-sm bg-gradient-to-t from-primary/40 to-primary" style={{ height: `${h}%` }} />
                ))}
              </div>
            </div>
          </div>

          <div className="mt-auto mx-3 mb-4 mt-3 flex items-center justify-around rounded-2xl border border-white/[0.06] bg-[#0F1218] py-2">
            {["Home", "Train", "Check-in", "Chat"].map((l, i) => (
              <div key={l} className={`text-[9px] font-semibold ${i === 1 ? "text-primary" : "text-[#7E848F]"}`}>{l}</div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function CoachingProcess() {
  const steps = [
    { n: "01", title: "Apply", body: "Tell me your goals, your history, and what's been stopping you. Takes about 3 minutes." },
    { n: "02", title: "I read it myself", body: "I read every application personally. No assistant, no auto-reply." },
    { n: "03", title: "We get on a call", body: "If it's a fit, we get on a call and map the plan together." },
    { n: "04", title: "Coaching begins", body: "Your plan, your check-ins, your adjustments, and direct access to me \u2014 all in one place." },
  ];
  return (
    <section className="container mx-auto px-4 py-16 md:py-24">
      <div className="mx-auto mb-10 max-w-2xl text-center">
        <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-primary">How this actually works</div>
        <h2 className="mt-2 text-3xl font-black tracking-tight md:text-4xl">A real process — not a checkout</h2>
        <p className="mt-3 text-sm text-muted-foreground md:text-base">
          This is application-only. I don't take everyone, and I don't take men I can't actually help.
        </p>
      </div>
      <ol className="relative mx-auto grid max-w-5xl gap-4 md:grid-cols-4">
        <div className="absolute left-0 right-0 top-6 hidden h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent md:block" />
        {steps.map((s) => (
          <li key={s.n} className="relative rounded-2xl border border-border/70 bg-card/60 p-5">
            <div className="grid h-9 w-9 place-items-center rounded-full border border-primary/40 bg-background text-xs font-black text-primary">
              {s.n}
            </div>
            <div className="mt-3 text-base font-bold">{s.title}</div>
            <div className="mt-1 text-sm text-muted-foreground">{s.body}</div>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function CoachingVsMembership({ onApply }: { onApply: () => void }) {
  return (
    <section className="container mx-auto px-4 py-16 md:py-24">
      <div className="mx-auto mb-10 max-w-2xl text-center">
        <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-primary">Coaching vs Membership</div>
        <h2 className="mt-2 text-3xl font-black tracking-tight md:text-4xl">Two different products. Pick the one you actually need.</h2>
      </div>
      <div className="mx-auto grid max-w-5xl gap-4 md:grid-cols-2">
        <div className="rounded-2xl border-2 border-primary/60 bg-gradient-to-br from-primary/10 via-card to-card p-6 shadow-xl shadow-primary/10">
          <div className="text-[11px] font-bold uppercase tracking-widest text-primary">Private Coaching</div>
          <div className="mt-1 text-2xl font-black">Built by me, led by me</div>
          <ul className="mt-4 space-y-2 text-sm">
            {[
              "A plan built for you, not pulled from a library",
              "Weekly check-ins I review myself",
              "Nutrition coaching built around your life",
              "Adjustments based on your actual numbers",
              "Direct access to me, anytime",
              "A real strategy call before you commit",
            ].map((l) => (
              <li key={l} className="flex items-start gap-2">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />{l}
              </li>
            ))}
          </ul>
          <Button onClick={onApply} className="mt-6 h-11 w-full font-bold">Apply for Private Coaching</Button>
        </div>
        <div className="rounded-2xl border border-border/70 bg-card/50 p-6">
          <div className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">JF Membership</div>
          <div className="mt-1 text-2xl font-black">Self-guided app subscription</div>
          <ul className="mt-4 space-y-2 text-sm text-muted-foreground">
            {[
              "The full app + workout library",
              "Pre-built training programs you choose from",
              "Exercise demos, tracking, analytics",
              "Nutrition resources + education",
              "Self-paced — no application",
              "No 1:1 coaching",
            ].map((l) => (
              <li key={l} className="flex items-start gap-2">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/60" />{l}
              </li>
            ))}
          </ul>
          <a href="/membership" className="mt-6 inline-flex h-11 w-full items-center justify-center rounded-md border border-border bg-background px-4 text-sm font-semibold hover:bg-muted">
            Explore Membership instead
          </a>
        </div>
      </div>
    </section>
  );
}
