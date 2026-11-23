import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getCoachingFunnel } from "@/lib/site-funnel.functions";
import { rate, type CoachingFunnel } from "@/lib/site-funnel-rules";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * How people find coaching (Sales → Coaching packages → How people find it):
 * the public site's steps, counted anonymously (a random id per browser, never
 * a person), from a visit to an application. Interest (package taps,
 * applications by package) is kept apart from customers (people whose
 * application was followed by a sale or a package), so a package that gets
 * tapped a lot but never sells is easy to see.
 */
const RANGES = [
  [7, "7 days"],
  [30, "30 days"],
  [90, "90 days"],
] as const;

const PACKAGE_WORD: Record<string, string> = {
  free: "Free app",
  nutrition: "Nutrition Coaching",
  complete: "Complete Online Coaching",
  plus: "Coaching Plus",
  none: "No package picked",
};
const word = (slug: string) => PACKAGE_WORD[slug] ?? slug.replace(/-/g, " ");

const DEVICE_WORD: Record<string, string> = { phone: "Phone", tablet: "Tablet", desktop: "Computer", unknown: "Not recorded" };

const STEP_WORD: Record<string, string> = {
  full_name: "Name",
  main_goal: "Goal",
  target_outcome: "Result they want",
  timeline: "When to start",
  email: "Email",
  phone: "Phone",
  instagram: "Instagram",
};

function Row({ label, value, of, hint }: { label: string; value: number; of?: number; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2.5">
      <div className="min-w-0">
        <p className="text-[15px]">{label}</p>
        {hint && <p className="text-[12px] text-muted-foreground">{hint}</p>}
      </div>
      <p className="shrink-0 text-[15px] font-semibold tabular-nums">
        {value}
        {of !== undefined && <span className="ml-2 text-[13px] font-normal text-muted-foreground">{rate(value, of)}</span>}
      </p>
    </div>
  );
}

function Counts({ title, counts, empty }: { title: string; counts: Record<string, number>; empty: string }) {
  const rows = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  return (
    <div>
      <p className="text-[13px] font-semibold text-muted-foreground">{title}</p>
      {rows.length ? (
        <div className="mt-1 divide-y divide-border/70">
          {rows.map(([k, n]) => (
            <div key={k} className="flex justify-between gap-3 py-2 text-[14px]">
              <span>{word(k)}</span>
              <span className="font-semibold tabular-nums">{n}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-1 text-[14px] text-muted-foreground">{empty}</p>
      )}
    </div>
  );
}

export function CoachingFunnelCard() {
  const [days, setDays] = useState<number>(30);
  const fn = useServerFn(getCoachingFunnel);
  const q = useQuery({ queryKey: ["coaching-funnel", days], queryFn: () => fn({ data: { days } }), staleTime: 60_000 });
  const f: CoachingFunnel | undefined = q.data?.funnel;
  const visitors = f ? Math.max(f.landingVisitors, 0) : 0;
  return (
    <div className="space-y-4" data-coaching-funnel>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="min-w-0 text-[14px] text-muted-foreground">
          Counted anonymously: a random id per browser, never a person. A visitor counts once a step a day.
        </p>
        <div className="inline-flex rounded-lg bg-muted p-1" role="group" aria-label="Period">
          {RANGES.map(([d, l]) => (
            <button
              key={d}
              type="button"
              onClick={() => setDays(d)}
              aria-pressed={days === d}
              className={cn("h-8 rounded-md px-3 text-[13px] font-medium transition", days === d ? "bg-background text-foreground shadow-sm" : "text-muted-foreground")}
            >
              {l}
            </button>
          ))}
        </div>
      </div>
      {q.isLoading && <div className="h-64 animate-pulse rounded-2xl bg-muted" />}
      {q.error && <p className="text-[14px] text-destructive">{(q.error as Error).message}</p>}
      {f && (
        <>
          <Card className="p-5">
            <h3 className="text-[16px] font-semibold">The home page</h3>
            <div className="mt-2 divide-y divide-border/70">
              <Row label="Visitors" value={visitors} />
              <Row label="Tapped Get the free app" value={f.ctaFree} of={visitors} />
              <Row label="Sent a free app application" value={f.freeSent} of={visitors} />
              <Row label="Tapped a coaching button" value={f.ctaCoaching} of={visitors} />
              <Row label="Saw the coaching prices" value={f.pricingViews} of={visitors} hint="The pricing section on the home page or the coaching page" />
            </div>
          </Card>
          <Card className="p-5">
            <h3 className="text-[16px] font-semibold">The coaching application</h3>
            <div className="mt-2 divide-y divide-border/70">
              <Row label="Visited the coaching page" value={f.coachingVisitors} />
              <Row label="Started the application" value={f.applyStarts} />
              <Row label="Sent it" value={f.applySent} of={f.applyStarts} />
            </div>
            {Object.keys(f.applySteps).length > 0 && (
              <div className="mt-4">
                <p className="text-[13px] font-semibold text-muted-foreground">Reached each question</p>
                <div className="mt-1 divide-y divide-border/70">
                  {Object.keys(STEP_WORD)
                    .filter((k) => k in f.applySteps)
                    .map((k) => (
                      <div key={k} className="flex justify-between gap-3 py-2 text-[14px]">
                        <span>{STEP_WORD[k]}</span>
                        <span className="font-semibold tabular-nums">
                          {f.applySteps[k]}
                          <span className="ml-2 text-[13px] font-normal text-muted-foreground">{rate(f.applySteps[k] ?? 0, f.applyStarts)}</span>
                        </span>
                      </div>
                    ))}
                </div>
              </div>
            )}
          </Card>
          <div className="grid gap-4 md:grid-cols-2">
            <Card className="space-y-4 p-5">
              <div>
                <h3 className="text-[16px] font-semibold">Interest</h3>
                <p className="text-[13px] text-muted-foreground">Who tapped a package, and which package their application was for.</p>
              </div>
              <Counts title="Package taps" counts={f.packageTaps} empty="No package taps yet." />
              <Counts title={`Applications (${f.applications})`} counts={f.applicationsByPackage} empty="No applications yet." />
            </Card>
            <Card className="space-y-4 p-5">
              <div>
                <h3 className="text-[16px] font-semibold">Customers</h3>
                <p className="text-[13px] text-muted-foreground">Applications in this period that were followed by a sale or a package.</p>
              </div>
              <Row label="Became clients" value={f.customers} of={f.applications} />
              <Counts title="By package" counts={f.customersByPackage} empty="None yet in this period." />
            </Card>
          </div>
          {f.devices.length > 0 && (
            <Card className="p-5">
              <h3 className="text-[16px] font-semibold">Phone, tablet or computer</h3>
              <div className="mt-2 overflow-x-auto">
                <table className="w-full text-[14px]">
                  <thead>
                    <tr className="text-left text-[13px] text-muted-foreground">
                      <th className="py-2 font-medium">Device</th>
                      <th className="py-2 text-right font-medium">Visitors</th>
                      <th className="py-2 text-right font-medium">Free app</th>
                      <th className="py-2 text-right font-medium">Coaching</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/70">
                    {f.devices.map((d) => (
                      <tr key={d.device}>
                        <td className="py-2">{DEVICE_WORD[d.device] ?? d.device}</td>
                        <td className="py-2 text-right tabular-nums">{d.visitors}</td>
                        <td className="py-2 text-right tabular-nums">
                          {d.joinedFree} <span className="text-muted-foreground">{rate(d.joinedFree, d.visitors)}</span>
                        </td>
                        <td className="py-2 text-right tabular-nums">
                          {d.applied} <span className="text-muted-foreground">{rate(d.applied, d.visitors)}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-[12px] text-muted-foreground">Visits from before Nov 23 2026 weren't recorded by device.</p>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
