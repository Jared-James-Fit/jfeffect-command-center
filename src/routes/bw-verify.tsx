import { createFileRoute } from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BodyweightTrendCard } from "@/components/analytics/bodyweight-trend-card";

// TEMPORARY verification harness — deleted after QA.
const JEN: Array<{ date: string; value: number; unit: "lb" | "kg" }> = [
["2026-06-18",108.8],["2026-06-21",108.6],["2026-06-22",111.2],["2026-06-23",109.6],["2026-06-24",108],["2026-06-25",108.4],["2026-06-26",108.2],["2026-06-27",106.8],["2026-06-28",108],["2026-06-29",108],["2026-06-30",108.8],["2026-07-02",109.2],["2026-07-03",109.2],["2026-07-04",108.2],["2026-07-05",108.4],["2026-07-06",109.6],["2026-07-08",108.6],["2026-07-09",108.4],["2026-07-10",107.6],["2026-07-11",107.8],["2026-07-12",104],["2026-07-13",104.6],["2026-07-14",107.4],["2026-07-16",108.2],["2026-07-17",108],["2026-07-18",108.4],["2026-07-20",110.2],["2026-07-21",109.2],["2026-07-22",109],["2026-07-30",107.4],["2026-08-01",107.4],["2026-08-02",108.6],["2026-08-06",108.8],
].map(([date, value]) => ({ date: date as string, value: value as number, unit: "lb" as const }));

const ONE_LB = [{ date: "2026-07-13", value: 175.5, unit: "lb" as const }];
const ONE_KG = [{ date: "2026-07-29", value: 62.4, unit: "kg" as const }];

const qc = new QueryClient();
function seed(id: string, start: string, end: string, all: typeof JEN) {
  qc.setQueryData(["analytics-bodyweight", id, start, end], {
    all,
    inRange: all.filter((p) => p.date >= start && p.date <= end),
  });
}
const d = (s: string) => new Date(s + "T00:00:00");

const CASES = [
  { id: "jen-life", label: "Lifetime", start: "2026-01-01", end: "2026-08-12", unit: "lb" as const, data: JEN },
  { id: "jen-block", label: "Current Block", start: "2026-07-01", end: "2026-07-31", unit: "lb" as const, data: JEN },
  { id: "jen-custom", label: "Custom", start: "2026-07-10", end: "2026-07-20", unit: "lb" as const, data: JEN },
  { id: "jen-kg", label: "Lifetime", start: "2026-01-01", end: "2026-08-12", unit: "kg" as const, data: JEN },
  { id: "one-lb", label: "Lifetime", start: "2026-01-01", end: "2026-08-12", unit: "lb" as const, data: ONE_LB },
  { id: "one-kg", label: "Lifetime", start: "2026-01-01", end: "2026-08-12", unit: "kg" as const, data: ONE_KG },
  { id: "empty", label: "Current Block", start: "2026-08-08", end: "2026-08-12", unit: "lb" as const, data: JEN },
  { id: "none", label: "Lifetime", start: "2026-01-01", end: "2026-08-12", unit: "lb" as const, data: [] as typeof JEN },
];
CASES.forEach((c) => seed(c.id, c.start, c.end, c.data));

export const Route = createFileRoute("/bw-verify")({
  ssr: false,
  component: () => (
    <QueryClientProvider client={qc}>
      <div className="space-y-6 p-3">
        {CASES.map((c) => (
          <div key={c.id} data-case={c.id}>
            <div className="text-xs font-bold">{c.id}</div>
            <BodyweightTrendCard
              clientId={c.id}
              displayUnit={c.unit}
              rangeStart={d(c.start)}
              rangeEnd={d(c.end)}
              rangeLabel={c.label}
            />
          </div>
        ))}
      </div>
    </QueryClientProvider>
  ),
});
