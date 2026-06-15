import { Button } from "@/components/ui/button";
import { ArrowRight, MessageCircle, Calendar, ClipboardCheck, Target } from "lucide-react";
import type { ReactNode } from "react";

/**
 * CoachingHero — distinct from SalesHero (which /join uses).
 *
 * Visual rhythm:
 *   - left column: editorial headline + private-coaching badge + warm red/orange glow
 *   - right column: human "coach interaction" mock (avatar + message + check-in card),
 *     not a phone screenshot. This signals service, not product.
 */
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
    <section className="relative overflow-hidden border-b border-border/60">
      {/* warmer coaching glow vs membership's cool radial */}
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_30%_20%,_hsl(var(--primary)/0.18),_transparent_55%),radial-gradient(ellipse_at_80%_85%,_hsl(25_95%_55%/0.10),_transparent_60%)]" />
      <div className="absolute inset-0 -z-10 bg-[linear-gradient(to_bottom,transparent,hsl(var(--background)))]" />

      <div className="container mx-auto grid gap-12 px-4 py-16 md:py-24 lg:grid-cols-[1.05fr_1fr] lg:items-center">
        <div>
          {eyebrow && (
            <div className="inline-flex items-center gap-2 rounded-full border border-primary/40 bg-primary/10 px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.18em] text-primary">
              <span className="h-1.5 w-1.5 rounded-full bg-primary" />
              {eyebrow}
            </div>
          )}
          <h1 className="mt-5 text-4xl font-black leading-[1.02] tracking-tight md:text-6xl lg:text-7xl">
            {headline}
          </h1>
          <p className="mt-5 max-w-xl text-base text-muted-foreground md:text-lg">{sub}</p>

          <div className="mt-7 flex flex-wrap gap-3">
            {primary}
            {secondary}
          </div>

          <div className="mt-8 grid max-w-md grid-cols-2 gap-x-6 gap-y-3 text-xs text-muted-foreground">
            <div className="flex items-center gap-2"><Target className="h-3.5 w-3.5 text-primary" /> Individualized programming</div>
            <div className="flex items-center gap-2"><ClipboardCheck className="h-3.5 w-3.5 text-primary" /> Weekly check-ins & adjustments</div>
            <div className="flex items-center gap-2"><MessageCircle className="h-3.5 w-3.5 text-primary" /> Direct coach messaging</div>
            <div className="flex items-center gap-2"><Calendar className="h-3.5 w-3.5 text-primary" /> Consultation before you commit</div>
          </div>

          <div className="mt-6 flex items-center gap-2 text-[11px] uppercase tracking-widest text-muted-foreground/80">
            <ArrowRight className="h-3 w-3" />
            <span>Application-based · By approval only</span>
          </div>
        </div>

        {/* Right column — coach interaction tableau (no fake phone, no AI persona) */}
        <div className="relative">
          <div className="absolute -inset-6 -z-10 rounded-[2rem] bg-gradient-to-br from-primary/20 via-transparent to-orange-500/10 blur-2xl" />

          {image ? (
            <img
              src={image}
              alt=""
              loading="eager"
              className="w-full rounded-2xl border border-border shadow-2xl shadow-primary/20"
            />
          ) : (
            <div className="relative">
              {/* Stacked, layered "coach process" cards. Pure UI — no synthetic client data shown. */}
              <div className="rounded-2xl border border-border/80 bg-card/70 p-5 shadow-2xl shadow-primary/10 backdrop-blur">
                <div className="flex items-start gap-3">
                  <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-gradient-to-br from-primary to-orange-500 text-sm font-black text-primary-foreground">
                    JF
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <div className="text-sm font-bold">Your coach</div>
                      <div className="text-[10px] uppercase tracking-widest text-primary">online</div>
                    </div>
                    <div className="mt-2 rounded-2xl rounded-tl-sm bg-primary/15 px-3 py-2 text-sm leading-relaxed text-foreground">
                      Reviewed your check-in — pushing top set on Wednesday up to a 7 RPE.
                      Calories holding for this week.
                    </div>
                    <div className="mt-1 text-[10px] text-muted-foreground">Adjusts your plan weekly</div>
                  </div>
                </div>
              </div>

              <div className="-mt-2 ml-6 rounded-2xl border border-border/80 bg-card/70 p-4 shadow-2xl shadow-primary/10 backdrop-blur">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">
                    <ClipboardCheck className="h-3.5 w-3.5 text-primary" /> Weekly check-in
                  </div>
                  <div className="text-[10px] rounded-full bg-emerald-500/15 px-2 py-0.5 font-bold uppercase tracking-widest text-emerald-300">Reviewed</div>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2">
                  {["Training", "Nutrition", "Recovery"].map((l) => (
                    <div key={l} className="rounded-lg border border-border/70 bg-background/60 p-2 text-center">
                      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{l}</div>
                      <div className="mt-1 h-1.5 w-full rounded-full bg-muted">
                        <div className="h-1.5 rounded-full bg-gradient-to-r from-primary to-orange-500" style={{ width: l === "Recovery" ? "60%" : "85%" }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="-mt-2 ml-12 rounded-2xl border border-border/80 bg-card/70 p-4 shadow-2xl shadow-primary/10 backdrop-blur">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">
                  <Target className="h-3.5 w-3.5 text-primary" /> Plan adjustment
                </div>
                <div className="mt-2 text-sm">
                  <span className="text-muted-foreground line-through">Squat 4×5 @ RPE 7</span>
                  <span className="ml-2 font-semibold text-foreground">→ 4×4 @ RPE 8</span>
                </div>
                <div className="mt-1 text-[10px] text-muted-foreground">Updated by coach · Today</div>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

/** Application process timeline — unique to /coaching. Not used on /join. */
export function CoachingProcess() {
  const steps = [
    { n: "01", title: "Apply", body: "Tell us about your goals, history, and what's stopped you so far. About 3 minutes." },
    { n: "02", title: "Application reviewed", body: "We read every application personally and check fit before responding." },
    { n: "03", title: "Consultation", body: "If it looks like a fit, we set up a call to confirm the plan together." },
    { n: "04", title: "Coaching begins", body: "Personalized programming, nutrition, check-ins, adjustments, and direct support inside the app." },
  ];
  return (
    <section className="container mx-auto px-4 py-16 md:py-24">
      <div className="mx-auto mb-10 max-w-2xl text-center">
        <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-primary">How coaching starts</div>
        <h2 className="mt-2 text-3xl font-black tracking-tight md:text-4xl">A real process — not a checkout</h2>
        <p className="mt-3 text-sm text-muted-foreground md:text-base">
          Coaching is application-based. We only take clients we believe we can help.
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

/** Coaching vs Membership pivot — only shown on /coaching, mirrors the inverse pivot on /join. */
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
          <div className="mt-1 text-2xl font-black">Coach-built, coach-led</div>
          <ul className="mt-4 space-y-2 text-sm">
            {[
              "Plan built for you, not pulled from a library",
              "Weekly check-ins reviewed by your coach",
              "Plan adjustments based on your data",
              "Direct messaging with your coach",
              "Lift video reviews with timestamped feedback",
              "Consultation before you commit",
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
              "Pre-built program library you choose from",
              "Tracking, analytics, and exercise demos",
              "Recipes, nutrition resources, education",
              "Member events and updates",
              "No 1:1 coach involvement",
              "Self-paced — no application required",
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