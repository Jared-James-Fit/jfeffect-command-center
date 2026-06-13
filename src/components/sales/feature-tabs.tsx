import { useState } from "react";
import { Dumbbell, LineChart, Apple, BookOpen, ListChecks } from "lucide-react";
import { SectionTitle } from "@/components/sales/sales-page-shell";

type TabKey = "training" | "tracking" | "analytics" | "nutrition" | "resources";

const TABS: Array<{
  key: TabKey;
  label: string;
  Icon: typeof Dumbbell;
  title: string;
  copy: string;
  bullets: string[];
}> = [
  {
    key: "training",
    label: "Training",
    Icon: Dumbbell,
    title: "Structured programs you can start today",
    copy: "Self-guided training blocks built by JF Effect — push/pull/legs, upper/lower, hypertrophy and strength phases. Switch programs anytime.",
    bullets: ["Multiple programs included", "Exercise library with video demos", "Built for the gym floor"],
  },
  {
    key: "tracking",
    label: "Tracking",
    Icon: ListChecks,
    title: "Log every set without leaving the app",
    copy: "Tap to log reps, load and RPE. Lifts auto-fill from your last session so you always know what to beat.",
    bullets: ["One-tap set logging", "PR detection", "Session history at a glance"],
  },
  {
    key: "analytics",
    label: "Analytics",
    Icon: LineChart,
    title: "See progress that actually means something",
    copy: "Weekly volume, intensity, frequency and PRs visualized so you can tell whether the work is paying off.",
    bullets: ["Volume & intensity trends", "PR timeline", "Per-lift progression"],
  },
  {
    key: "nutrition",
    label: "Nutrition",
    Icon: Apple,
    title: "Recipes and guidance you'll actually use",
    copy: "A growing recipe library plus nutrition education resources — no extra app required.",
    bullets: ["High-protein recipe library", "Filter by macro goal", "Updated continuously"],
  },
  {
    key: "resources",
    label: "Resources",
    Icon: BookOpen,
    title: "Education that makes the program click",
    copy: "Articles, videos and member-only updates so you understand the why behind the work.",
    bullets: ["Member-only education", "How-to & technique", "Mindset & recovery"],
  },
];

/**
 * FeatureTabs — Explore the app.
 * Membership-page only. Interactive tab strip that swaps the preview panel,
 * giving Membership a product feel that Coaching deliberately does NOT use.
 */
export function FeatureTabs() {
  const [active, setActive] = useState<TabKey>("training");
  const current = TABS.find((t) => t.key === active)!;

  return (
    <section className="container mx-auto px-4 py-14 md:py-20">
      <SectionTitle eyebrow="Explore the app" title="Built for self-guided lifters" />

      {/* Tab strip */}
      <div className="mx-auto max-w-3xl">
        <div className="flex flex-wrap items-center justify-center gap-2 rounded-full border border-border bg-card/50 p-1.5">
          {TABS.map(({ key, label, Icon }) => {
            const isActive = key === active;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setActive(key)}
                aria-pressed={isActive}
                className={
                  "inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-bold transition " +
                  (isActive
                    ? "bg-primary text-primary-foreground shadow-md shadow-primary/30"
                    : "text-muted-foreground hover:text-foreground")
                }
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Panel */}
      <div className="mt-8 grid gap-8 lg:grid-cols-[1.05fr_1fr] lg:items-center">
        <div className="rounded-3xl border border-border bg-gradient-to-br from-card via-card to-background p-6 md:p-8">
          <div className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-primary">
            <current.Icon className="h-3 w-3" /> {current.label}
          </div>
          <h3 className="mt-3 text-2xl font-black tracking-tight md:text-3xl">{current.title}</h3>
          <p className="mt-3 text-sm text-muted-foreground md:text-base">{current.copy}</p>
          <ul className="mt-5 space-y-2 text-sm">
            {current.bullets.map((b) => (
              <li key={b} className="flex items-start gap-2">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                <span className="text-foreground/90">{b}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Visual placeholder — branded, no fake screenshots */}
        <FeatureVisual tab={current.key} />
      </div>

      <p className="mt-4 text-center text-[11px] text-muted-foreground">
        Previews shown above are synthetic illustrations of the live app interface.
      </p>
    </section>
  );
}

function FeatureVisual({ tab }: { tab: TabKey }) {
  return (
    <div className="relative aspect-[4/3] overflow-hidden rounded-3xl border border-border bg-gradient-to-br from-background via-card to-background">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_hsl(var(--primary)/0.15),_transparent_60%)]" />
      <div className="relative grid h-full place-items-center p-6">
        <PreviewBody tab={tab} />
      </div>
    </div>
  );
}

function PreviewBody({ tab }: { tab: TabKey }) {
  if (tab === "training") {
    return (
      <div className="w-full max-w-sm space-y-2">
        {[
          { name: "Bench Press", set: "4 × 6 @ RPE 8" },
          { name: "Incline DB Press", set: "3 × 10 @ RPE 7" },
          { name: "Overhead Press", set: "3 × 8 @ RPE 8" },
          { name: "Cable Fly", set: "3 × 12 @ RPE 7" },
        ].map((x) => (
          <div key={x.name} className="flex items-center justify-between rounded-xl border border-border bg-card/70 px-3 py-2 text-sm">
            <span className="font-semibold">{x.name}</span>
            <span className="text-xs text-muted-foreground">{x.set}</span>
          </div>
        ))}
      </div>
    );
  }
  if (tab === "tracking") {
    return (
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card/70 p-4">
        <div className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Bench Press</div>
        <div className="mt-1 text-xl font-black">Set 3 of 4</div>
        <div className="mt-3 grid grid-cols-3 gap-2 text-center">
          {["Reps · 6", "Load · 205", "RPE · 8"].map((x) => (
            <div key={x} className="rounded-lg border border-border bg-background/50 py-2 text-xs font-semibold">{x}</div>
          ))}
        </div>
        <div className="mt-3 text-[10px] text-muted-foreground">Last session: 200 × 6 @ RPE 8</div>
      </div>
    );
  }
  if (tab === "analytics") {
    return (
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card/70 p-4">
        <div className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Weekly volume</div>
        <div className="mt-1 text-2xl font-black">28,420 lb</div>
        <div className="mt-3 flex h-24 items-end gap-1.5">
          {[40, 52, 48, 60, 58, 72, 68, 80, 76, 88, 84, 92].map((h, i) => (
            <div key={i} className="flex-1 rounded-sm bg-gradient-to-t from-primary/30 to-primary" style={{ height: `${h}%` }} />
          ))}
        </div>
        <div className="mt-2 text-[10px] text-muted-foreground">12-week trend · +18% vs. prior block</div>
      </div>
    );
  }
  if (tab === "nutrition") {
    return (
      <div className="grid w-full max-w-sm gap-2">
        {[
          { name: "High-protein chili", k: "42P · 38C · 14F" },
          { name: "Sheet-pan salmon", k: "46P · 22C · 18F" },
          { name: "Overnight oats", k: "28P · 54C · 9F" },
        ].map((r) => (
          <div key={r.name} className="flex items-center justify-between rounded-xl border border-border bg-card/70 px-3 py-2 text-sm">
            <span className="font-semibold">{r.name}</span>
            <span className="text-[10px] text-muted-foreground">{r.k}</span>
          </div>
        ))}
      </div>
    );
  }
  // resources
  return (
    <div className="grid w-full max-w-sm grid-cols-2 gap-2">
      {["Why RPE works", "Programming 101", "Recovery basics", "Plateau fixes"].map((t) => (
        <div key={t} className="rounded-xl border border-border bg-card/70 p-3 text-sm font-semibold">
          {t}
          <div className="mt-1 text-[10px] font-normal text-muted-foreground">Article · 4 min read</div>
        </div>
      ))}
    </div>
  );
}