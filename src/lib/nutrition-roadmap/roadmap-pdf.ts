/**
 * The nutrition roadmap as a PDF (Nov 22 2026), drawn with the JF Effect PDF
 * kit: the journey to the goal as the person's own roadmap screen shows it,
 * nothing more. An athlete's copy is the athlete's sheet (their words, "you",
 * the coach's pending changes never shown), a coach's copy the coach's card.
 *
 * Where they are (the status in words, the planned weight against their
 * level), the chart (weigh-ins, the 7-day average, the planned path and its
 * range, the projection, the target), every block of the journey (dates,
 * targets, the rate, why, priorities, checkpoints, when to move on and the
 * keep / change / extend / end rules; only the current block is final), the
 * next check-in, whether the goal is realistic and the options that work, and
 * what changed. Every number is the engine's (src/lib/nutrition-roadmap); the
 * chart draws the same points the screen does.
 */
import { PdfDoc, PDF_COLOR, type Tone } from "@/lib/pdf/kit";
import { chartRow, dayTime, drawLineChart } from "@/lib/pdf/charts";
import { pdfDate, pdfFileName, pdfText } from "@/lib/pdf/text";
import { loadPdfLogo } from "@/lib/pdf/deliver";
import { fmtRate, fmtWeight, fromKg, round } from "@/lib/weight-management/units";
import { withSevenDayAverage } from "@/lib/nutrition-targets/nutrition-progress";
import {
  BLOCK_LABEL,
  GOAL_KIND_LABEL,
  STATUS_LABEL,
  type Block,
  type ProgressStatus,
} from "@/lib/nutrition-roadmap/types";
import { toYou, type RoadmapView } from "@/lib/nutrition-roadmap/view";

const STATUS_PDF_TONE: Record<ProgressStatus, Tone> = {
  on_track: "good",
  ahead: "good",
  behind: "warn",
  insufficient_data: "muted",
  needs_attention: "bad",
};
const VERDICT: Record<string, { label: string; tone: Tone }> = {
  realistic: { label: "Realistic", tone: "good" },
  aggressive: { label: "Aggressive", tone: "warn" },
  unlikely: { label: "Unlikely", tone: "warn" },
  unsafe: { label: "Not safe", tone: "bad" },
  no_deadline: { label: "No date set", tone: "muted" },
  reached: { label: "Reached", tone: "good" },
  no_goal: { label: "No goal yet", tone: "muted" },
  needs_weigh_ins: { label: "Needs weigh-ins", tone: "warn" },
};
const TRIGGER_WORD: Record<string, string> = {
  initial: "First roadmap",
  reforecast: "Reforecast",
  goal_change: "Goal changed",
  adjustment: "Targets",
  coach: "Coach's refresh",
  checkin: "After a check-in",
};

function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  const t = new Date(y, m - 1, d + n);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
}

export function buildRoadmapPdf(
  view: RoadmapView,
  opts: {
    audience: "athlete" | "coach";
    personName?: string | null;
    logo?: string | null;
    generatedAt?: Date;
  },
): PdfDoc {
  const athlete = opts.audience === "athlete";
  const say = (t: string | null | undefined) => pdfText(athlete ? toYou(t ?? "") : (t ?? ""));
  const unit = view.unit;
  const W = (kg: number | null | undefined) => (kg != null ? fmtWeight(kg, unit) : "–");
  const read = view.read;
  const plan = read?.plan ?? null;
  const g = plan?.goal ?? null;
  const person = opts.personName ?? view.firstName ?? null;

  const pdf = new PdfDoc({
    kind: "Nutrition roadmap",
    title: g
      ? `${GOAL_KIND_LABEL[g.kind]}${g.kg != null ? ` · ${W(g.kg)}` : ""}`
      : "Nutrition roadmap",
    subtitle: g?.date
      ? `${g.eventName ? `${pdfText(g.eventName)} · ` : ""}${pdfDate(g.date)}`
      : plan
        ? `Made ${pdfDate(plan.madeOn)}`
        : null,
    person,
    logo: opts.logo,
    generatedAt: opts.generatedAt,
    facts: read
      ? [
          ["Status", STATUS_LABEL[read.progress.status]],
          ["Now", read.progress.currentKg != null ? W(read.progress.currentKg) : null],
          ["Planned today", read.progress.expectedKg != null ? W(read.progress.expectedKg) : null],
          [view.selfCoached ? "Next check-in" : "Next review", pdfDate(read.checkin.on)],
        ]
      : [],
  });

  if (!read || !plan) {
    pdf.paragraph(
      view.state === "waiting_coach"
        ? athlete
          ? "Your coach is putting your roadmap together. It shows here once they've approved it."
          : "The roadmap is waiting for your approval."
        : "There's no goal to plan toward yet. Set a goal weight and date, or a meet, and the roadmap follows.",
      { color: PDF_COLOR.muted },
    );
    return pdf;
  }

  // ── where they are ──
  pdf.heading("Where things stand", {
    keepWith: 80,
    right: STATUS_LABEL[read.progress.status],
    rightTone: STATUS_PDF_TONE[read.progress.status],
  });
  const holding =
    read.decision.action === "hold" &&
    (read.progress.status === "on_track" || read.progress.status === "ahead");
  pdf.paragraph(
    `${pdfText(read.progress.headline)}. ${say(read.progress.detail)}${holding ? " No nutrition changes needed." : ""}`.replace(
      /\.\./g,
      ".",
    ),
    { size: 10 },
  );
  if (view.explanation?.summary)
    pdf.paragraph(
      `${view.explanation.summary}${view.explanation.focus ? ` ${view.explanation.focus}` : ""}`,
      { size: 9.5, color: PDF_COLOR.muted },
    );
  pdf.tiles([
    {
      label: "Rate now",
      value:
        read.progress.currentKgPerWeek != null
          ? fmtRate(read.progress.currentKgPerWeek, unit)
          : "–",
    },
    {
      label: "Rate needed",
      value:
        read.progress.requiredKgPerWeek != null
          ? fmtRate(read.progress.requiredKgPerWeek, unit)
          : "–",
    },
    {
      label: "Weeks to goal",
      value: read.progress.weeksToGoal != null ? String(read.progress.weeksToGoal) : "–",
    },
    {
      label: "Weigh-ins, last 14 days",
      value: String(read.progress.reliability.weighIns14),
      sub: pdfText(read.progress.reliability.label),
    },
  ]);
  if (plan.safety.referral)
    pdf.callout("Health first", say(plan.safety.referral), { tone: "warn" });

  if (athlete) {
    if (read.decision.action !== "hold" && read.decision.approval === "coach") {
      pdf.paragraph("Your coach is looking at what to change. Nothing changes until they do.", {
        size: 9.5,
        color: PDF_COLOR.muted,
      });
    } else if (
      view.selfCoached &&
      ["investigate", "reconsider", "escalate"].includes(read.decision.action)
    ) {
      pdf.callout(
        pdfText(read.decision.headline),
        [...new Set([...read.decision.reasons.slice(-2), ...read.decision.other.slice(0, 2)])]
          .map(say)
          .join(" "),
        { tone: "neutral" },
      );
    }
  } else if (read.decision.action !== "hold") {
    pdf.callout(
      pdfText(read.decision.headline),
      [...read.decision.reasons, ...read.decision.other].map((r) => pdfText(r)).join(" "),
      { tone: read.decision.action === "escalate" ? "bad" : "warn" },
    );
  }

  // ── the chart: what the roadmap screen draws ──
  const first = view.series.length ? view.series[0].date : plan.madeOn;
  const from = [first, addDays(plan.madeOn, -42)].sort().pop()!;
  const u = (kg: number) => round(fromKg(kg, unit), 1);
  const raw = view.series
    .filter((p) => p.date >= from)
    .map((p) => ({ date: p.date, value: u(p.kg) }));
  const avg = withSevenDayAverage(
    view.series.map((p) => ({ date: p.date, value: u(p.kg) })),
  ).filter((p) => p.date >= from);
  const path = plan.path.filter((p) => p.date >= from);
  const pr = read.progress.projected;
  const lastWeigh = view.series[view.series.length - 1];
  const end = path.length ? path[path.length - 1].date : addDays(plan.madeOn, 28);
  pdf.heading("Bodyweight against the plan", { level: 2, keepWith: 190 });
  chartRow(pdf, 190, [
    (doc, box) =>
      drawLineChart(doc, box, {
        unit,
        series: [
          {
            label: "Weigh-ins",
            points: raw.map((p) => ({ t: dayTime(p.date), v: p.value })),
            color: [178, 181, 189],
            dotsOnly: true,
            legendValue: null,
          },
          {
            label: "7-day average",
            points: avg.map((p) => ({ t: dayTime(p.date), v: p.avg })),
            color: PDF_COLOR.ink,
            width: 1.6,
          },
          {
            label: "Planned",
            points: path.map((p) => ({ t: dayTime(p.date), v: u(p.kg) })),
            color: PDF_COLOR.muted,
            width: 1,
            dash: [2, 2],
            legendValue: null,
          },
          ...(pr && lastWeigh && read.progress.currentKg != null
            ? [
                {
                  label: "Projected",
                  points: [
                    { t: dayTime(lastWeigh.date), v: u(read.progress.currentKg) },
                    { t: dayTime(pr.date), v: u(pr.kg) },
                  ],
                  color: PDF_COLOR.body,
                  width: 1.2,
                  dash: [4, 3],
                },
              ]
            : []),
          ...(g?.kg != null
            ? [
                {
                  label: "Target",
                  points: [
                    { t: dayTime(from), v: u(g.kg) },
                    { t: dayTime(end), v: u(g.kg) },
                  ],
                  color: PDF_COLOR.brand,
                  width: 0.9,
                  dash: [1, 2],
                },
              ]
            : []),
        ],
        band:
          path.length > 1
            ? {
                points: path.map((p) => ({ t: dayTime(p.date), lo: u(p.lowKg), hi: u(p.highKg) })),
                color: PDF_COLOR.muted,
                opacity: 0.14,
                label: "Planned range",
              }
            : null,
        markers: plan.blocks
          .slice(1)
          .filter((b) => b.start >= from)
          .map((b) => ({ t: dayTime(b.start), label: "" })),
      }),
  ]);
  if (!view.series.length)
    pdf.paragraph("No weigh-ins yet: the line fills in as weigh-ins are logged.", {
      size: 8.5,
      color: PDF_COLOR.muted,
    });

  // ── the journey ──
  pdf.heading("The journey", { keepWith: 100 });
  pdf.table({
    columns: [
      { header: "Block", width: "auto", bold: true },
      { header: "Dates", width: "fit", max: 150, muted: true },
      { header: "Weeks", width: 40, align: "center" },
      { header: "Calories", width: "fit", align: "right" },
      { header: "Weight", width: "fit", max: 130, align: "right" },
    ],
    rows: plan.blocks.map((b) => [
      b.title || BLOCK_LABEL[b.kind],
      `${pdfDate(b.start, { year: "never" })} – ${pdfDate(b.end)}`,
      String(b.weeks),
      `${(b.energy.from === "plan" ? b.energy.kcal : b.energy.engine.kcal).toLocaleString("en-US")} kcal${!b.final && b.status === "upcoming" ? "*" : ""}`,
      b.weight ? `${W(b.weight.startKg)} to ${W(b.weight.targetKg)}` : "",
    ]),
    sub: new Map(
      plan.blocks.map(
        (b, i) =>
          [
            `${i}:0`,
            b.status === "current"
              ? "Now"
              : b.status === "done"
                ? "Done"
                : b.locked
                  ? "Upcoming · locked"
                  : "Upcoming",
          ] as [string, string],
      ),
    ),
    cellTone: (r) =>
      plan.blocks[r].status === "current"
        ? "neutral"
        : plan.blocks[r].status === "done"
          ? "muted"
          : null,
    footnotes: [
      "Only the block you're in is final. *Everything after it is a forecast that updates as the data comes in.",
    ].map((t) => (athlete ? t : t.replace("you're", "they're"))),
  });

  plan.blocks.forEach((b) => blockSection(pdf, b, unit, say));

  // ── check-ins, feasibility, missing, history ──
  pdf.heading(view.selfCoached ? "Next check-in" : "Next review", { level: 2, keepWith: 30 });
  pdf.paragraph(
    `${pdfDate(read.checkin.on, { weekday: true })} · ${pdfText(read.checkin.reason)}`,
    { size: 9.5 },
  );

  if (g) {
    const f = plan.feasibility;
    const v = VERDICT[f.verdict] ?? { label: f.verdict, tone: "muted" as Tone };
    pdf.heading("Is the goal realistic?", {
      level: 2,
      keepWith: 60,
      right: v.label,
      rightTone: v.tone,
    });
    pdf.paragraph(pdfText(f.headline), {
      size: 10,
      style: "bold",
      color: PDF_COLOR.ink,
      gapAfter: 3,
    });
    pdf.bullets(f.reasons.map(say), { size: 9.25 });
    if (f.expected)
      pdf.paragraph(
        `Likely on the date: ${W(f.expected.lowKg)} to ${W(f.expected.highKg)} (${f.expected.basis === "trend" ? say("from their trend") : "if the plan is followed"}). Confidence: ${f.confidence}. ${say(f.confidenceWhy)}`,
        { size: 9.25, color: PDF_COLOR.muted },
      );
    if (f.tradeoffs.length) {
      pdf.heading("The trade-offs", { level: 3, keepWith: 24 });
      pdf.bullets(f.tradeoffs.map(say), { size: 9.25 });
    }
    if (f.alternatives.length) {
      pdf.heading("Options that work", { level: 3, keepWith: 30 });
      pdf.table({
        columns: [
          { header: "", width: 170, bold: true },
          { header: "", width: "auto" },
        ],
        rows: f.alternatives.map((a) => [pdfText(a.label), say(a.detail)]),
        hideHeader: true,
      });
    }
  }

  if (plan.missing.length && (view.selfCoached || !athlete)) {
    pdf.heading("What would make it more accurate", { level: 2, keepWith: 30 });
    pdf.bullets(plan.missing.map(say), { size: 9.25 });
  }

  if (view.history.length) {
    pdf.heading("What changed", { level: 2, keepWith: 50 });
    pdf.table({
      dense: true,
      columns: [
        { header: "When", width: 76, muted: true },
        { header: "What", width: 110, bold: true },
        { header: "Changes", width: "auto" },
      ],
      rows: view.history.map((h) => [
        pdfDate(h.createdAt),
        `${TRIGGER_WORD[h.trigger] ?? h.trigger}`,
        [h.changes.slice(0, 4).join(" · "), h.note ? `Note: ${h.note}` : null]
          .filter(Boolean)
          .join(" · ") || "–",
      ]),
      sub: new Map(
        view.history.map(
          (h, i) =>
            [
              `${i}:1`,
              `${h.status === "active" ? "In effect" : h.status === "proposed" ? "Waiting" : h.status === "rejected" ? "Declined" : "Replaced"}${h.autoApplied ? " · by itself" : ""}`,
            ] as [string, string],
        ),
      ),
    });
  }
  return pdf;
}

function blockSection(
  pdf: PdfDoc,
  b: Block,
  unit: "kg" | "lb",
  say: (t: string | null | undefined) => string,
) {
  const W = (kg: number) => fmtWeight(kg, unit);
  const e = b.energy.from === "plan" ? b.energy : b.energy.engine;
  pdf.heading(b.title || BLOCK_LABEL[b.kind], {
    level: 2,
    keepWith: 90,
    right:
      b.status === "current"
        ? "Now"
        : b.status === "done"
          ? "Done"
          : b.final
            ? "Upcoming"
            : "Forecast",
    rightTone: b.status === "current" ? "brand" : "muted",
    sub: `${pdfDate(b.start)} – ${pdfDate(b.end)} · ${b.weeks} week${b.weeks === 1 ? "" : "s"}${b.locked ? " · locked by the coach" : ""}`,
  });
  pdf.paragraph(say(b.objective), { size: 9.5 });
  const detail: Array<[string, string | null]> = [
    [
      b.final ? "Targets now" : "Expected targets",
      `${e.kcal.toLocaleString("en-US")} kcal · protein ${e.proteinG} g · carbs ${e.carbsG} g · fat ${e.fatG} g`,
    ],
    [
      "Training and rest days",
      b.energy.training && b.energy.rest
        ? `Training days ${b.energy.training.kcal.toLocaleString("en-US")} kcal · rest days ${b.energy.rest.kcal.toLocaleString("en-US")} kcal`
        : null,
    ],
    [
      "The roadmap calls for",
      b.energy.from === "plan" && Math.abs(b.energy.engine.kcal - b.energy.kcal) >= 150
        ? `About ${b.energy.engine.kcal.toLocaleString("en-US")} kcal in this block`
        : null,
    ],
    [
      "Weight",
      b.weight && b.rate.kgPerWeek !== 0
        ? `${W(b.weight.startKg)} to ${W(b.weight.targetKg)} at ${fmtRate(b.rate.kgPerWeek, unit)} (${Math.abs(b.rate.pctPerWeek)}% a week)`
        : null,
    ],
    ["Why this block", say(b.why)],
  ];
  pdf.details(detail, { labelWidth: 130, gapAfter: 6 });
  if (b.energy.notes.length)
    pdf.bullets(b.energy.notes.map(say), { size: 8.75, color: PDF_COLOR.muted });
  if (b.priorities.length) {
    pdf.heading("Priorities", { level: 3, keepWith: 20 });
    pdf.bullets(b.priorities.map(say), { size: 9.25 });
  }
  if (b.checkpoints.length) {
    pdf.heading("Checkpoints", { level: 3, keepWith: 40 });
    pdf.table({
      dense: true,
      columns: [
        { header: "Date", width: 90 },
        { header: "Expected range", width: "fit", align: "right" },
        { header: "", width: "auto", muted: true },
      ],
      rows: b.checkpoints.map((c) => [
        pdfDate(c.date, { weekday: true }),
        `${W(c.lowKg)} to ${W(c.highKg)}`,
        say(c.label),
      ]),
    });
  }
  if (b.moveOnWhen.length) {
    pdf.heading("Move on when", { level: 3, keepWith: 20 });
    pdf.bullets(b.moveOnWhen.map(say), { size: 9.25 });
  }
  pdf.details(
    [
      ["Keep it", say(b.rules.keep)],
      ["Change it", say(b.rules.change)],
      ["Extend it", say(b.rules.extend)],
      ["End it", say(b.rules.end)],
    ],
    { labelWidth: 80, gapAfter: 10 },
  );
}

/** The roadmap as a PDF file, for the share sheet or a download. */
export async function roadmapPdfFile(
  view: RoadmapView,
  audience: "athlete" | "coach",
  personName?: string | null,
): Promise<File> {
  return buildRoadmapPdf(view, { audience, personName, logo: await loadPdfLogo() }).toFile(
    pdfFileName({ person: personName ?? view.firstName, document: "nutrition roadmap" }),
  );
}
