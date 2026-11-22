/**
 * The progress report (Nov 22 2026), drawn with the JF Effect PDF kit: the
 * analytics page's period as a document a coach can hand an athlete, or an
 * athlete can keep. Downloaded from the analytics page (the athlete's and the
 * coach's), it reads exactly what that page reads:
 *
 * - training: the page's training load (`buildTrainingLoad` over the filter's
 *   dates): sessions, working and hard sets, completion of what was
 *   prescribed, tonnage, the insights (the coach's copy adds the coach-only
 *   ones), each competition lift's sessions, sets, best estimated max and its
 *   trend, drawn from the very points the trend reads (`LiftLoad.points`),
 *   sets a week against what was written, sets per muscle, and the records in
 *   the period (`recentPRs`);
 * - bodyweight: every weigh-in in the period and the 7-day average, with the
 *   change from the first week to the last;
 * - nutrition: the plan they're on (each day type's targets) and the weekly
 *   check-ins' nutrition consistency.
 *
 * A source with too little in it says so in a line instead of a chart; no
 * number is estimated to fill a gap.
 */
import { PdfDoc, PDF_COLOR, type Tone } from "@/lib/pdf/kit";
import { chartRow, dayTime, drawBarChart, drawLineChart } from "@/lib/pdf/charts";
import { isoDay, pdfDate, pdfFileName, pdfNumber, pdfRange, pdfText, plural } from "@/lib/pdf/text";
import { LIFT_LABEL, type Insight, type TrainingLoad } from "@/lib/analytics/training-load";
import { trendWords } from "@/lib/analytics/strength-read";
import { withSevenDayAverage } from "@/lib/nutrition-targets/nutrition-progress";

const LB_PER_KG = 2.2046226218;

export type ProgressReportInput = {
  athlete: string | null;
  audience: "coach" | "client";
  period: { label: string; start: Date; end: Date };
  unit: "kg" | "lb";
  load: TrainingLoad;
  /** recentPRs over the period's results (loads in lb, as the page holds them). */
  prs: Array<{
    exercise_name?: string | null;
    load?: number | null;
    reps?: number | null;
    est_1rm?: number | null;
    delta?: number | null;
    date?: string | null;
  }>;
  /** Weigh-ins in the report's unit, oldest first (null when they couldn't be read). */
  bodyweight: Array<{ date: string; value: number }> | null;
  nutrition: {
    plan: {
      phase: string | null;
      start: string | null;
      end: string | null;
      days: Array<{
        label: string;
        calories: number | null;
        protein: number | null;
        carbs: number | null;
        fats: number | null;
      }>;
    } | null;
    /** Weekly check-ins' nutrition consistency, 1–5. */
    ratings: Array<{ date: string; rating: number }>;
  } | null;
  generatedAt?: Date;
};

const TONE: Record<Insight["tone"], Tone> = { good: "good", info: "neutral", watch: "warn" };

export function buildProgressReport(
  x: ProgressReportInput,
  opts: { logo?: string | null } = {},
): PdfDoc {
  const { load, unit } = x;
  const w = (kg: number | null | undefined) =>
    kg == null ? "–" : `${pdfNumber(unit === "lb" ? kg * LB_PER_KG : kg, 1)} ${unit}`;
  const t = load.totals;
  const from = isoDay(x.period.start);
  const to = isoDay(x.period.end);
  const pdf = new PdfDoc({
    kind: "Progress report",
    title: pdfText(x.period.label) || "Progress report",
    subtitle: pdfRange(from, to),
    person: x.athlete,
    logo: opts.logo,
    generatedAt: x.generatedAt,
    facts: [
      ["Athlete", x.athlete],
      ["Sessions", t.sessions ? String(t.sessions) : "None logged"],
      ["Working sets a week", t.sets ? pdfNumber(t.setsPerWeek, 1) : null],
      ["Plan completed", t.completionPct != null ? `${t.completionPct}%` : null],
    ],
  });

  // ── at a glance ──
  pdf.heading("At a glance", { keepWith: 80 });
  if (!t.sets) {
    pdf.paragraph("No training was logged in this period.", { color: PDF_COLOR.muted });
  } else {
    pdf.tiles([
      {
        label: "Sessions",
        value: String(t.sessions),
        sub: `${plural(load.completeWeeks, "full week")}`,
      },
      {
        label: "Working sets",
        value: t.sets.toLocaleString("en-US"),
        sub: `${pdfNumber(t.setsPerWeek, 1)} a week`,
      },
      {
        label: "Hard sets (RPE 7+)",
        value: t.hardSets.toLocaleString("en-US"),
        sub: t.unratedSets ? `${t.unratedSets} not rated` : null,
      },
      {
        label: "Plan completed",
        value: t.completionPct != null ? `${t.completionPct}%` : "–",
        sub:
          t.prescribed != null
            ? `${t.completedOfPrescribed ?? 0} of ${t.prescribed} sets`
            : "No plan for these dates",
        tone:
          t.completionPct == null
            ? "neutral"
            : t.completionPct >= 85
              ? "good"
              : t.completionPct >= 65
                ? "neutral"
                : "warn",
      },
    ]);
    pdf.paragraph(
      `Tonnage ${w(t.tonnageKg)} across ${t.reps.toLocaleString("en-US")} reps. Working sets leave out warm-ups; hard sets are RPE 7 or harder (RIR 3 or fewer).`,
      { size: 8.5, color: PDF_COLOR.muted },
    );
  }

  // ── what stands out ──
  const insights = load.insights.filter((i) => x.audience === "coach" || i.audience === "both");
  if (insights.length) {
    pdf.heading(x.audience === "coach" ? "Coaching insights" : "What stands out", { keepWith: 70 });
    const notes = new Map<number, string>();
    insights.forEach((i, k) => {
      const parts = [
        i.observation,
        i.explanation ? `Why it may be: ${i.explanation}` : null,
        i.action ? (i.actionNeeded ? `What to do: ${i.action}` : i.action) : null,
      ].filter(Boolean);
      notes.set(k, parts.join("  "));
    });
    pdf.table({
      columns: [
        { header: "", width: 64 },
        { header: "", width: "auto", bold: true },
      ],
      rows: insights.map((i) => [
        i.tone === "good" ? "Going well" : i.tone === "watch" ? "Watch" : "Note",
        `${pdfText(i.title)}${x.audience === "coach" && i.audience === "coach" ? " (coach only)" : ""}`,
      ]),
      notes,
      hideHeader: true,
      cellTone: (r, col) => (col === 0 ? TONE[insights[r].tone] : null),
    });
  }

  // ── strength ──
  const lifts = load.lifts.filter((l) => l.sessions > 0);
  if (lifts.length) {
    pdf.heading("Strength", { keepWith: 120 });
    pdf.table({
      columns: [
        { header: "Lift", width: "auto", bold: true },
        { header: "Sessions a week", width: "fit", align: "right" },
        { header: "Sets a week", width: "fit", align: "right" },
        { header: "Best estimated max", width: "fit", align: "right" },
        { header: "Trend", width: "fit", max: 120 },
        { header: "Avg RPE", width: "fit", align: "right" },
      ],
      rows: lifts.map((l) => [
        LIFT_LABEL[l.lift],
        pdfNumber(l.sessionsPerWeek, 1),
        pdfNumber(l.setsPerWeek, 1),
        w(l.bestE1rmKg),
        trendWords(l.trend),
        l.avgRpe != null ? pdfNumber(l.avgRpe, 1) : null,
      ]),
      cellTone: (r, col) =>
        col === 4
          ? lifts[r].trend.kind === "up"
            ? "good"
            : lifts[r].trend.kind === "down"
              ? "warn"
              : null
          : null,
      footnotes: [
        "Estimated max from sets that can show one (RPE 7 or harder, 10 reps or fewer), the best each session. Trend compares the best of the first few sessions with the best of the last few; under 2% is steady.",
      ],
    });
    const charted = lifts.filter((l) => l.points.length >= 2);
    if (charted.length) {
      chartRow(
        pdf,
        150,
        charted.map(
          (l) => (doc, box) =>
            drawLineChart(doc, box, {
              title: `${LIFT_LABEL[l.lift]} estimated max (${unit})`,
              unit,
              decimals: 0,
              series: [
                {
                  label: "Best each session",
                  points: l.points.map((p) => ({
                    t: dayTime(p.date),
                    v: unit === "lb" ? p.value * LB_PER_KG : p.value,
                  })),
                  color: PDF_COLOR.ink,
                  width: 1.4,
                  dots: true,
                },
              ],
              legend: false,
            }),
        ),
      );
    }
  }

  if (x.prs.length) {
    pdf.heading("Records in this period", { level: 2, keepWith: 60 });
    const list = x.prs.slice(0, 15);
    pdf.table({
      columns: [
        { header: "Exercise", width: "auto", bold: true },
        { header: "Set", width: "fit", align: "right" },
        { header: "Estimated max", width: "fit", align: "right" },
        { header: "Up by", width: "fit", align: "right" },
        { header: "Date", width: 80, muted: true },
      ],
      rows: list.map((p) => [
        pdfText(p.exercise_name) || "Exercise",
        p.load != null && p.reps != null ? `${w(Number(p.load) / LB_PER_KG)} × ${p.reps}` : null,
        p.est_1rm != null ? w(Number(p.est_1rm) / LB_PER_KG) : null,
        p.delta != null ? w(Number(p.delta) / LB_PER_KG) : null,
        p.date ? pdfDate(p.date) : null,
      ]),
      footnotes: x.prs.length > list.length ? [`And ${x.prs.length - list.length} more.`] : [],
    });
  }

  // ── volume ──
  if (load.weeks.length) {
    pdf.heading("Training volume", { keepWith: 170 });
    chartRow(pdf, 160, [
      (doc, box) =>
        drawBarChart(doc, box, {
          title: "Working sets each week",
          bars: load.weeks.map((wk) => ({
            label: wk.label,
            value: wk.sets,
            target: wk.prescribed,
            highlight: wk.current,
          })),
          targetLabel: "Written in the program",
          valueLabels: load.weeks.length <= 14,
        }),
    ]);
    const muscles = load.muscles.filter((m) => m.perWeek > 0).slice(0, 14);
    if (muscles.length) {
      pdf.heading("Sets per muscle", { level: 3, keepWith: 120 });
      pdf.table({
        columns: [
          { header: "Muscle", width: "auto", bold: true },
          { header: "Sets a week", width: "fit", align: "right" },
          { header: "Of them direct", width: "fit", align: "right" },
          { header: "Days a week", width: "fit", align: "right" },
          { header: "Change", width: "fit", align: "right" },
        ],
        rows: muscles.map((m) => [
          pdfText(m.muscle).replace(/^./, (c) => c.toUpperCase()),
          pdfNumber(m.perWeek, 1),
          pdfNumber(m.directPerWeek, 1),
          pdfNumber(m.frequency, 1),
          m.changePct != null ? `${m.changePct > 0 ? "+" : ""}${m.changePct}%` : null,
        ]),
        footnotes: [
          "A set counts fully toward the muscle it's aimed at and half toward the ones that help. Change is the last two full weeks against the two before.",
        ],
      });
    }
  }

  // ── bodyweight ──
  pdf.heading("Bodyweight", { keepWith: 150 });
  const bw = (x.bodyweight ?? []).filter((p) => p.date >= from && p.date <= to);
  if (x.bodyweight == null) {
    pdf.paragraph("Weigh-ins couldn't be read for this report.", { color: PDF_COLOR.muted });
  } else if (bw.length < 2) {
    pdf.paragraph(
      bw.length
        ? "One weigh-in in this period: not enough for a trend."
        : "No weigh-ins in this period.",
      { color: PDF_COLOR.muted },
    );
  } else {
    const avg = withSevenDayAverage(x.bodyweight).filter((p) => p.date >= from && p.date <= to);
    const first = avg[0];
    const last = avg[avg.length - 1];
    const days = Math.max(1, Math.round((dayTime(last.date) - dayTime(first.date)) / 86_400_000));
    const change = last.avg - first.avg;
    pdf.tiles([
      { label: "7-day average now", value: `${pdfNumber(last.avg, 1)} ${unit}` },
      {
        label: "Change",
        value: `${change > 0 ? "+" : ""}${pdfNumber(change, 1)} ${unit}`,
        sub: `over ${plural(days, "day")}`,
      },
      {
        label: "A week",
        value:
          days >= 14 ? `${change > 0 ? "+" : ""}${pdfNumber((change / days) * 7, 2)} ${unit}` : "–",
        sub: days >= 14 ? null : "Two weeks of weigh-ins needed",
      },
      { label: "Weigh-ins", value: String(bw.length) },
    ]);
    chartRow(pdf, 170, [
      (doc, box) =>
        drawLineChart(doc, box, {
          unit,
          series: [
            {
              label: "Weigh-ins",
              points: bw.map((p) => ({ t: dayTime(p.date), v: p.value })),
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
          ],
        }),
    ]);
  }

  // ── nutrition ──
  if (x.nutrition) {
    const n = x.nutrition;
    pdf.heading("Nutrition", { keepWith: 80 });
    if (n.plan && n.plan.days.length) {
      pdf.table({
        columns: [
          {
            header: n.plan.phase ? `${pdfText(n.plan.phase)} plan` : "Plan",
            width: "auto",
            bold: true,
          },
          { header: "Calories", width: 64, align: "right" },
          { header: "Protein", width: 54, align: "right" },
          { header: "Carbs", width: 54, align: "right" },
          { header: "Fat", width: 48, align: "right" },
        ],
        rows: n.plan.days.map((d) => [
          pdfText(d.label),
          d.calories != null ? `${pdfNumber(d.calories, 0)} kcal` : null,
          d.protein != null ? `${d.protein} g` : null,
          d.carbs != null ? `${d.carbs} g` : null,
          d.fats != null ? `${d.fats} g` : null,
        ]),
        footnotes: [
          n.plan.start || n.plan.end
            ? `On this plan ${pdfRange(n.plan.start, n.plan.end).replace(/^From /, "from ")}.`
            : null,
        ],
      });
    } else {
      pdf.paragraph("No nutrition plan on file.", { color: PDF_COLOR.muted });
    }
    const ratings = n.ratings.filter((r) => r.date >= from && r.date <= to);
    if (ratings.length) {
      const avg = ratings.reduce((a, r) => a + r.rating, 0) / ratings.length;
      pdf.paragraph(
        `Nutrition consistency from the weekly check-ins: ${pdfNumber(avg, 1)} out of 5 over ${plural(ratings.length, "check-in")}.`,
        { size: 9.5 },
      );
      if (ratings.length >= 3) {
        chartRow(pdf, 120, [
          (doc, box) =>
            drawBarChart(doc, box, {
              title: "Nutrition consistency (1 to 5)",
              bars: ratings.map((r) => ({
                label: pdfDate(r.date, { year: "never" }),
                value: r.rating,
              })),
              valueLabels: ratings.length <= 12,
            }),
        ]);
      }
    } else {
      pdf.paragraph("No weekly check-ins rated nutrition in this period.", {
        size: 9,
        color: PDF_COLOR.muted,
      });
    }
  }

  // ── how much to trust it ──
  const q = load.quality;
  if (q.ratedShare != null || q.weeksWithData) {
    pdf.heading("About the data", { level: 3, keepWith: 30 });
    pdf.paragraph(
      [
        q.weeksWithData ? `${plural(q.weeksWithData, "week")} with training logged.` : null,
        q.ratedShare != null
          ? `${Math.round(q.ratedShare * 100)}% of working sets had an RPE or RIR.`
          : null,
        q.untaggedShare != null && q.untaggedShare > 0.05
          ? `${Math.round(q.untaggedShare * 100)}% of sets were on exercises with no muscle tags, so they're left out of the muscle table.`
          : null,
      ]
        .filter(Boolean)
        .join(" "),
      { size: 8.5, color: PDF_COLOR.muted },
    );
  }
  return pdf;
}

export function progressReportFileName(
  athlete: string | null,
  periodLabel: string,
  date = new Date(),
): string {
  return pdfFileName({ person: athlete, document: "progress report", detail: periodLabel, date });
}
