import { Button } from "@/components/ui/button";
import type { ReactNode } from "react";

export function CoachingHero({
  eyebrow, headline, sub, primary, secondary, image,
}: {
  eyebrow?: string;
  headline: string;
  sub: string;
  primary: ReactNode;
  secondary?: ReactNode;
  image?: string | null;
}) {
  return (
    <section className="relative isolate overflow-hidden border-b border-white/10 bg-[#0a0a0a] text-white">
      {image && (
        <div className="pointer-events-none absolute inset-0 -z-10">
          <img
            src={image}
            alt=""
            loading="eager"
            className="absolute inset-0 h-full w-full object-cover object-[70%_center] opacity-70 lg:opacity-90"
          />
          <div className="absolute inset-0 bg-[linear-gradient(90deg,#0a0a0a_0%,#0a0a0a_38%,rgba(10,10,10,0.85)_55%,rgba(10,10,10,0.35)_80%,rgba(10,10,10,0.15)_100%)] lg:bg-[linear-gradient(90deg,#0a0a0a_0%,#0a0a0a_28%,rgba(10,10,10,0.78)_48%,rgba(10,10,10,0.25)_75%,rgba(10,10,10,0)_100%)]" />
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_18%_30%,_color-mix(in_oklab,var(--primary)_22%,transparent),transparent_55%)]" />
        </div>
      )}

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

        <div className="hidden lg:block" />
      </div>

      {!image && (
        <div className="container mx-auto -mt-16 px-4 pb-16 md:pb-24">
          <div className="relative mx-auto max-w-md">
            <div className="relative">
              <div className="rounded-2xl border border-white/10 bg-white/5 p-5 shadow-2xl shadow-primary/10 backdrop-blur">
                <div className="flex items-start gap-3">
                  <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-gradient-to-br from-primary to-orange-500 text-sm font-black text-primary-foreground">
                    JF
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <div className="text-sm font-bold">Your coach</div>
                      <div className="text-[10px] uppercase tracking-widest text-primary">online</div>
                    </div>
                    <div className="mt-2 rounded-2xl rounded-tl-sm bg-primary/15 px-3 py-2 text-sm leading-relaxed">
                      Reviewed your check-in — pushing top set on Wednesday up to a 7 RPE.
                      Calories holding for this week.
                    </div>
                    <div className="mt-1 text-[10px] text-white/55">Adjusts your plan weekly</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
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
