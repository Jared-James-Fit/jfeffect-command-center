import { Button } from "@/components/ui/button";
import { Smartphone, TrendingUp, Dumbbell, Apple, BookOpen, CheckCircle2 } from "lucide-react";
import type { ReactNode } from "react";

/**
 * MembershipHero — product-led counterpart to CoachingHero.
 *
 * Visual rhythm:
 *   - LEFT  : price chip, headline, value bullets, primary trial CTA
 *   - RIGHT : stylized phone frame with a synthetic-but-realistic app preview,
 *             plus two floating feature cards (analytics + program).
 *
 * Cool blue/red product glow (vs. coaching's warm orange).
 * No real client data is rendered — labels are generic ("Today's session",
 * "Weekly volume", "Program · Push / Pull / Legs").
 */
export function MembershipHero({
  priceChip,
  headline,
  sub,
  primary,
  secondary,
  trialNote,
  heroImage,
}: {
  priceChip: string;
  headline: string;
  sub: string;
  primary: ReactNode;
  secondary?: ReactNode;
  trialNote?: string;
  heroImage?: string | null;
}) {
  return (
    <section className="relative overflow-hidden border-b border-border/60">
      {/* Cool product glow — distinct from coaching's warm radial. */}
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_85%_15%,_hsl(var(--primary)/0.16),_transparent_55%),radial-gradient(ellipse_at_15%_90%,_hsl(220_90%_60%/0.10),_transparent_60%)]" />
      <div className="absolute inset-0 -z-10 bg-[linear-gradient(to_bottom,transparent,hsl(var(--background)))]" />

      <div className="container mx-auto grid gap-12 px-4 py-14 md:py-20 lg:grid-cols-[1fr_1.05fr] lg:items-center">
        {/* LEFT — copy + offer */}
        <div className="min-w-0">
          <div className="inline-flex items-center gap-2 rounded-full border border-primary/40 bg-primary/10 px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.18em] text-primary">
            <Smartphone className="h-3 w-3" />
            JF Membership · {priceChip}
          </div>
          <h1 className="mt-5 text-4xl font-black leading-[1.04] tracking-tight md:text-6xl">
            {headline}
          </h1>
          <p className="mt-5 max-w-xl text-base text-muted-foreground md:text-lg">{sub}</p>

          <ul className="mt-6 grid gap-2 text-sm">
            {[
              "Self-guided training plans you start the moment you join",
              "Workout logger, exercise demos, PRs and analytics in one app",
              "Recipes, nutrition and education resources updated continuously",
            ].map((line) => (
              <li key={line} className="flex items-start gap-2 text-foreground/90">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <span>{line}</span>
              </li>
            ))}
          </ul>

          <div className="mt-7 flex flex-wrap gap-2">
            {primary}
            {secondary}
          </div>
          {trialNote && (
            <p className="mt-3 text-xs text-muted-foreground">{trialNote}</p>
          )}
        </div>

        {/* RIGHT — phone frame + floating cards. Synthetic preview, never real data. */}
        <div className="relative mx-auto w-full max-w-[460px] lg:max-w-none">
          <PhoneFrame heroImage={heroImage ?? null} />

          {/* Floating analytics card — top right */}
          <div className="pointer-events-none absolute -right-2 top-6 hidden w-[200px] animate-[heroFloat_6s_ease-in-out_infinite] rounded-2xl border border-border/80 bg-card/95 p-3 shadow-2xl shadow-primary/10 backdrop-blur md:block">
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              <TrendingUp className="h-3 w-3 text-primary" /> Weekly volume
            </div>
            <div className="mt-2 text-2xl font-black">+12.4%</div>
            <div className="mt-2 flex h-10 items-end gap-1">
              {[40, 55, 48, 62, 70, 65, 78].map((h, i) => (
                <div
                  key={i}
                  className="flex-1 rounded-sm bg-gradient-to-t from-primary/30 to-primary"
                  style={{ height: `${h}%` }}
                />
              ))}
            </div>
          </div>

          {/* Floating program card — bottom left */}
          <div className="pointer-events-none absolute -left-2 bottom-8 hidden w-[210px] animate-[heroFloat_7s_ease-in-out_infinite_reverse] rounded-2xl border border-border/80 bg-card/95 p-3 shadow-2xl shadow-primary/10 backdrop-blur md:block" style={{ animationDelay: "-2s" }}>
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              <Dumbbell className="h-3 w-3 text-primary" /> Today's session
            </div>
            <div className="mt-2 text-sm font-bold">Push · Week 3, Day 1</div>
            <div className="mt-1 text-[11px] text-muted-foreground">5 lifts · 42 min · RPE 7</div>
            <div className="mt-2 flex gap-1">
              <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold text-primary">Bench</span>
              <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold">OHP</span>
              <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold">Dips</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/**
 * Phone frame containing a synthetic JF app preview.
 * Uses generic, branded labels — no real client names, no fake testimonials.
 */
function PhoneFrame({ heroImage }: { heroImage: string | null }) {
  return (
    <div className="relative mx-auto aspect-[9/19] w-[280px] rounded-[2.4rem] border border-border/80 bg-card p-2 shadow-[0_30px_80px_-20px_hsl(var(--primary)/0.35)] md:w-[320px]">
      {/* notch */}
      <div className="absolute left-1/2 top-2 z-10 h-5 w-24 -translate-x-1/2 rounded-b-2xl bg-background/95" />
      {/* screen */}
      <div className="relative h-full w-full overflow-hidden rounded-[2rem] bg-background">
        {heroImage ? (
          <img
            src={heroImage}
            alt="JF Membership app preview"
            loading="eager"
            className="h-full w-full object-cover"
          />
        ) : (
          <SyntheticAppPreview />
        )}
      </div>
    </div>
  );
}

function SyntheticAppPreview() {
  return (
    <div className="flex h-full w-full flex-col bg-gradient-to-b from-background via-background to-card">
      {/* header */}
      <div className="px-4 pb-2 pt-8">
        <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">JF Effect</div>
        <div className="mt-1 text-lg font-black leading-tight">Welcome back</div>
        <div className="text-[11px] text-muted-foreground">Week 3 · Push / Pull / Legs</div>
      </div>

      {/* hero card */}
      <div className="mx-3 mt-1 rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/15 to-primary/5 p-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-widest text-primary">Today</div>
            <div className="text-sm font-bold">Upper Body · Push</div>
          </div>
          <div className="rounded-full bg-primary px-3 py-1 text-[10px] font-bold uppercase text-primary-foreground">
            Start
          </div>
        </div>
        <div className="mt-2 flex items-center gap-3 text-[10px] text-muted-foreground">
          <span>5 lifts</span><span>·</span><span>42 min</span><span>·</span><span>RPE 7</span>
        </div>
      </div>

      {/* feature row */}
      <div className="mx-3 mt-3 grid grid-cols-3 gap-2">
        {[
          { Icon: Dumbbell, label: "Training" },
          { Icon: Apple, label: "Nutrition" },
          { Icon: BookOpen, label: "Resources" },
        ].map(({ Icon, label }) => (
          <div key={label} className="rounded-xl border border-border bg-card/60 p-2 text-center">
            <Icon className="mx-auto h-4 w-4 text-primary" />
            <div className="mt-1 text-[9px] font-semibold">{label}</div>
          </div>
        ))}
      </div>

      {/* progress */}
      <div className="mx-3 mt-3 rounded-2xl border border-border bg-card/50 p-3">
        <div className="flex items-center justify-between text-[10px]">
          <span className="font-bold uppercase tracking-widest text-muted-foreground">Weekly progress</span>
          <span className="font-bold text-primary">4 / 5</span>
        </div>
        <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-muted">
          <div className="h-full w-4/5 bg-primary" />
        </div>
        <div className="mt-3 flex items-end gap-1">
          {[55, 68, 72, 65, 78, 82, 88].map((h, i) => (
            <div
              key={i}
              className="flex-1 rounded-sm bg-gradient-to-t from-primary/25 to-primary/80"
              style={{ height: `${Math.max(8, h * 0.35)}px` }}
            />
          ))}
        </div>
      </div>

      {/* upcoming */}
      <div className="mx-3 mt-3 space-y-1.5">
        {["Tue · Pull · 38 min", "Wed · Legs · 45 min", "Thu · Rest day"].map((row) => (
          <div
            key={row}
            className="flex items-center justify-between rounded-lg border border-border/60 bg-card/40 px-2.5 py-1.5 text-[10px] text-foreground/90"
          >
            <span>{row}</span>
            <span className="text-muted-foreground">›</span>
          </div>
        ))}
      </div>

      <div className="flex-1" />

      {/* bottom nav stub */}
      <div className="mx-3 mb-3 mt-2 flex items-center justify-around rounded-2xl border border-border/60 bg-card/70 py-2 text-[9px] font-semibold text-muted-foreground">
        <span className="text-primary">Home</span>
        <span>Train</span>
        <span>Log</span>
        <span>You</span>
      </div>
    </div>
  );
}

export function MemberHeroCta({ children, ...props }: React.ComponentProps<typeof Button>) {
  return (
    <Button size="lg" className="h-12 px-6 text-base font-bold shadow-lg shadow-primary/20" {...props}>
      {children}
    </Button>
  );
}

export function MemberHeroGhost({ children, ...props }: React.ComponentProps<typeof Button>) {
  return (
    <Button size="lg" variant="outline" className="h-12 px-6 text-base" {...props}>
      {children}
    </Button>
  );
}