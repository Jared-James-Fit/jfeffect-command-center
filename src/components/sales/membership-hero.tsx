import { Button } from "@/components/ui/button";
import {
  Smartphone, TrendingUp, Dumbbell, Apple, BookOpen,
  ListChecks, LineChart, Sparkles, ChevronDown, User, Users,
} from "lucide-react";
import type { ReactNode } from "react";

export function MembershipHero({
  priceChip,
  headline,
  sub,
  primary,
  secondary,
  trialNote,
  heroImage,
  decisionArea,
  detailsLink,
}: {
  priceChip: string;
  headline: string;
  sub: string;
  primary: ReactNode;
  secondary?: ReactNode;
  trialNote?: string;
  heroImage?: string | null;
  decisionArea?: ReactNode;
  detailsLink?: ReactNode;
}) {
  return (
    <section className="relative isolate overflow-hidden border-b border-white/[0.08] bg-[#090A0C] text-[#F5F5F7]">
      <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_85%_-10%,_color-mix(in_oklab,var(--primary)_18%,transparent),transparent_55%)]" />
      <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_10%_110%,#1A1E27_0%,transparent_55%)]" />
      <div className="pointer-events-none absolute inset-0 -z-10 bg-[linear-gradient(180deg,#090A0C_0%,#0B0D12_60%,#090A0C_100%)]" />
      <div className="pointer-events-none absolute inset-0 -z-10 opacity-[0.035] mix-blend-overlay [background-image:radial-gradient(circle_at_1px_1px,#fff_1px,transparent_0)] [background-size:3px_3px]" />

      <div className="container mx-auto grid gap-12 px-4 py-14 md:py-20 lg:grid-cols-[1.05fr_1fr] lg:items-center">
        <div className="min-w-0">
          <div className="inline-flex items-center gap-2 rounded-full border border-primary/40 bg-primary/15 px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.18em] text-primary">
            <Smartphone className="h-3 w-3" />
            JF Membership · {priceChip}
          </div>
          <h1 className="mt-5 max-w-[18ch] text-4xl font-black leading-[1.02] tracking-tight text-white md:text-5xl lg:text-[3.6rem]">
            {headline}
          </h1>
          <p className="mt-5 max-w-xl text-base text-[#B0B4BE] md:text-lg">{sub}</p>

          <ul className="mt-7 grid gap-4">
            {[
              {
                Icon: ListChecks,
                title: "Walk In Knowing the Plan",
                body: "Pick a plan and walk into every session knowing exactly what to do. No more standing around deciding.",
              },
              {
                Icon: LineChart,
                title: "See the Work Pay Off",
                body: "Log every set, watch your PRs climb, and actually see whether what you're doing is working.",
              },
              {
                Icon: Sparkles,
                title: "Everything in One Place",
                body: "Demos, recipes, nutrition, education \u2014 everything you need so the plan actually sticks.",
              },
            ].map(({ Icon, title, body }) => (
              <li key={title} className="flex items-start gap-3">
                <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-primary/35 bg-primary/12 text-primary">
                  <Icon className="h-4 w-4" />
                </div>
                <div>
                  <div className="text-sm font-bold text-white">{title}</div>
                  <div className="text-sm text-[#B0B4BE]">{body}</div>
                </div>
              </li>
            ))}
          </ul>

          {decisionArea && (
            <div className="mt-8 rounded-2xl border border-white/10 bg-[#111318]/80 p-4 backdrop-blur">
              {decisionArea}
            </div>
          )}

          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            {primary}
            {secondary}
          </div>
          {trialNote && (
            <p className="mt-3 text-xs text-[#7E848F]">{trialNote}</p>
          )}
          {detailsLink && <div className="mt-4">{detailsLink}</div>}
        </div>

        <div className="relative mx-auto w-full max-w-[460px] lg:max-w-none">
          <PhoneFrame heroImage={heroImage ?? null} />

          <div className="pointer-events-none absolute -right-2 top-6 hidden w-[200px] animate-[heroFloat_6s_ease-in-out_infinite] rounded-2xl border border-white/[0.14] bg-[#151821] p-3 shadow-[0_20px_50px_-10px_rgba(0,0,0,0.6)] backdrop-blur md:block">
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-[#7E848F]">
              <TrendingUp className="h-3 w-3 text-primary" /> Weekly volume
            </div>
            <div className="mt-2 text-2xl font-black text-white">+12.4%</div>
            <div className="mt-2 flex h-10 items-end gap-1">
              {[40, 55, 48, 62, 70, 65, 78].map((h, i) => (
                <div
                  key={i}
                  className="flex-1 rounded-sm bg-gradient-to-t from-primary/40 to-primary"
                  style={{ height: `${h}%` }}
                />
              ))}
            </div>
          </div>

          <div className="pointer-events-none absolute -left-2 bottom-8 hidden w-[210px] animate-[heroFloat_7s_ease-in-out_infinite_reverse] rounded-2xl border border-white/[0.14] bg-[#151821] p-3 shadow-[0_20px_50px_-10px_rgba(0,0,0,0.6)] backdrop-blur md:block" style={{ animationDelay: "-2s" }}>
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-[#7E848F]">
              <Dumbbell className="h-3 w-3 text-primary" /> Today's session
            </div>
            <div className="mt-2 text-sm font-bold text-white">Push · Week 3, Day 1</div>
            <div className="mt-1 text-[11px] text-[#B0B4BE]">5 lifts · 42 min · RPE 7</div>
            <div className="mt-2 flex gap-1">
              <span className="rounded-full bg-primary/20 px-2 py-0.5 text-[10px] font-semibold text-primary">Bench</span>
              <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-semibold text-white/85">OHP</span>
              <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-semibold text-white/85">Dips</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function PhoneFrame({ heroImage }: { heroImage: string | null }) {
  return (
    <div className="relative mx-auto aspect-[9/19] w-[280px] rounded-[2.4rem] border border-white/[0.08] bg-gradient-to-b from-[#1A1E27] via-[#0d0f13] to-[#000] p-[6px] shadow-[0_40px_90px_-20px_rgba(0,0,0,0.85),0_0_0_1px_rgba(255,255,255,0.04)_inset] md:w-[320px]">
      <div className="absolute inset-[6px] rounded-[2.05rem] ring-1 ring-white/[0.04]" />
      <div className="absolute left-1/2 top-[10px] z-10 h-5 w-24 -translate-x-1/2 rounded-b-2xl bg-black" />
      <div className="relative h-full w-full overflow-hidden rounded-[2rem] bg-[#0A0B0E]">
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
    <div className="flex h-full w-full flex-col bg-gradient-to-b from-[#0A0B0E] via-[#0B0D12] to-[#111318] text-white">
      <div className="px-4 pb-2 pt-8">
        <div className="text-[10px] font-bold uppercase tracking-widest text-[#7E848F]">JF Effect</div>
        <div className="mt-1 text-lg font-black leading-tight">Welcome back</div>
        <div className="text-[11px] text-[#B0B4BE]">Week 3 · Push / Pull / Legs</div>
      </div>

      <div className="mx-3 mt-1 rounded-2xl border border-primary/40 bg-gradient-to-br from-primary/25 to-primary/5 p-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-widest text-primary">Today</div>
            <div className="text-sm font-bold">Upper Body · Push</div>
          </div>
          <div className="rounded-full bg-primary px-3 py-1 text-[10px] font-bold uppercase text-primary-foreground">
            Start Workout
          </div>
        </div>
        <div className="mt-2 flex items-center gap-3 text-[10px] text-[#B0B4BE]">
          <span>5 lifts</span><span>·</span><span>42 min</span><span>·</span><span>RPE 7</span>
        </div>
      </div>

      <div className="mx-3 mt-3 grid grid-cols-3 gap-2">
        {[
          { Icon: Dumbbell, label: "Training" },
          { Icon: Apple, label: "Nutrition" },
          { Icon: BookOpen, label: "Resources" },
        ].map(({ Icon, label }) => (
          <div key={label} className="rounded-xl border border-white/[0.08] bg-[#151821]/80 p-2 text-center">
            <Icon className="mx-auto h-4 w-4 text-primary" />
            <div className="mt-1 text-[9px] font-semibold text-white/90">{label}</div>
          </div>
        ))}
      </div>

      <div className="mx-3 mt-3 rounded-2xl border border-white/[0.08] bg-[#151821]/80 p-3">
        <div className="flex items-center justify-between text-[10px]">
          <span className="font-bold uppercase tracking-widest text-[#7E848F]">Weekly progress</span>
          <span className="font-bold text-primary">4 / 5</span>
        </div>
        <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-white/10">
          <div className="h-full w-4/5 bg-primary" />
        </div>
        <div className="mt-3 flex items-end gap-1">
          {[55, 68, 72, 65, 78, 82, 88].map((h, i) => (
            <div
              key={i}
              className="flex-1 rounded-sm bg-gradient-to-t from-primary/30 to-primary"
              style={{ height: `${Math.max(8, h * 0.35)}px` }}
            />
          ))}
        </div>
      </div>

      <div className="mx-3 mt-3 space-y-1.5">
        {["Tue · Pull · 38 min", "Wed · Legs · 45 min", "Thu · Rest day"].map((row) => (
          <div
            key={row}
            className="flex items-center justify-between rounded-lg border border-white/[0.06] bg-[#111318]/70 px-2.5 py-1.5 text-[10px] text-white/85"
          >
            <span>{row}</span>
            <span className="text-[#7E848F]">›</span>
          </div>
        ))}
      </div>

      <div className="flex-1" />

      <div className="mx-3 mb-3 mt-2 flex items-center justify-around rounded-2xl border border-white/[0.08] bg-[#151821]/80 py-2 text-[9px] font-semibold text-[#7E848F]">
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
    <Button size="lg" className="h-12 px-6 text-base font-bold shadow-[0_10px_30px_-10px_rgba(220,38,38,0.55)]" {...props}>
      {children}
    </Button>
  );
}

export function MemberHeroGhost({ children, ...props }: React.ComponentProps<typeof Button>) {
  return (
    <Button
      size="lg"
      variant="outline"
      className="h-12 px-6 text-base bg-[#1A1E27] border-white/15 text-white hover:bg-[#222632] hover:text-white"
      {...props}
    >
      {children}
    </Button>
  );
}

export function HeroDecisionArea({ onCoachingClick }: { onCoachingClick?: () => void }) {
  return (
    <div>
      <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#B0B4BE]">
        Choose how much support you want.
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <div className="rounded-xl border border-primary/35 bg-[#0F1116] p-3">
          <div className="flex items-center gap-2 text-xs font-bold text-white">
            <User className="h-3.5 w-3.5 text-primary" /> Train Independently
          </div>
          <div className="mt-1 text-[11px] leading-snug text-[#B0B4BE]">
            Get the app and run the system on your own. You set the pace.
          </div>
        </div>
        <button
          type="button"
          onClick={onCoachingClick}
          className="text-left rounded-xl border border-white/10 bg-[#0F1116] p-3 hover:border-primary/40 hover:bg-[#13161D] transition-colors"
        >
          <div className="flex items-center gap-2 text-xs font-bold text-white">
            <Users className="h-3.5 w-3.5 text-primary" /> Work Directly With Me
          </div>
          <div className="mt-1 text-[11px] leading-snug text-[#B0B4BE]">
            Apply to work with me directly — your plan, your accountability, dialed in over time.
          </div>
        </button>
      </div>
    </div>
  );
}

export function MemberDetailsLink({ onClick }: { onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 text-xs font-semibold text-[#B0B4BE] underline-offset-4 hover:text-white hover:underline"
    >
      See everything included in Membership <ChevronDown className="h-3 w-3" />
    </button>
  );
}
