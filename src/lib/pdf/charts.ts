/**
 * Charts for the PDFs, drawn as vectors (lines and shapes, never pictures):
 * sharp at any zoom, a few hundred bytes each, and drawn from exactly the
 * numbers the tables beside them print.
 *
 * Restrained on purpose: hairline grid, three to five round-number ticks, the
 * data in ink or the brand red, a band for a range, a legend that names each
 * line once with its latest value. Nothing is drawn for a series with no
 * points; a chart with nothing to show says so instead of drawing empty axes.
 */
import type { jsPDF } from "jspdf";
import { PDF_COLOR, PDF_TYPE, type PdfDoc, type RGB } from "@/lib/pdf/kit";
import { pdfDate, pdfNumber, pdfText } from "@/lib/pdf/text";

export type ChartPoint = { t: number; v: number };
export type Series = {
  label: string;
  points: ChartPoint[];
  color: RGB;
  width?: number;
  /** Draw each point as a dot (raw weigh-ins); else only the line. */
  dots?: boolean;
  /** Dots only, no line. */
  dotsOnly?: boolean;
  dash?: number[];
  /** The legend's value: the last point unless said. */
  legendValue?: string | null;
};
export type Band = {
  points: Array<{ t: number; lo: number; hi: number }>;
  color: RGB;
  opacity?: number;
  label?: string;
};

/** Round-number ticks covering [lo, hi]: 3 to 5 of them. */
export function niceTicks(lo: number, hi: number, want = 4): number[] {
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [];
  if (hi === lo) {
    const pad = Math.abs(hi) * 0.05 || 1;
    lo -= pad;
    hi += pad;
  }
  const raw = (hi - lo) / Math.max(1, want - 1);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  const start = Math.floor(lo / step) * step;
  const end = Math.ceil(hi / step) * step;
  const out: number[] = [];
  for (let v = start; v <= end + step / 2; v += step) out.push(Math.round(v / step) * step);
  return out;
}

const DAY = 86_400_000;

/** A date string or Date as a time for the x axis (noon, so a day never slips). */
export function dayTime(d: string | Date): number {
  if (d instanceof Date) return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12).getTime();
  const [y, m, day] = String(d).slice(0, 10).split("-").map(Number);
  return new Date(y, (m || 1) - 1, day || 1, 12).getTime();
}

type Box = { x: number; y: number; w: number; h: number };

function setColor(doc: jsPDF, c: RGB, kind: "draw" | "fill" | "text") {
  if (kind === "draw") doc.setDrawColor(c[0], c[1], c[2]);
  else if (kind === "fill") doc.setFillColor(c[0], c[1], c[2]);
  else doc.setTextColor(c[0], c[1], c[2]);
}

function withOpacity(doc: jsPDF, opacity: number, draw: () => void) {
  const anyDoc = doc as unknown as {
    GState?: new (o: { opacity: number }) => unknown;
    setGState?: (g: unknown) => void;
  };
  if (anyDoc.GState && anyDoc.setGState) {
    anyDoc.setGState(new anyDoc.GState({ opacity }));
    draw();
    anyDoc.setGState(new anyDoc.GState({ opacity: 1 }));
  } else draw();
}

/** A line chart over time in `box`. Returns false (and draws nothing) when there's nothing to plot. */
export function drawLineChart(
  doc: jsPDF,
  box: Box,
  o: {
    series: Series[];
    band?: Band | null;
    unit?: string;
    decimals?: number;
    markers?: Array<{ t: number; label: string }>;
    legend?: boolean;
    title?: string | null;
  },
): boolean {
  const series = o.series.filter((s) => s.points.length);
  if (!series.length) return false;
  const decimals = o.decimals ?? 1;
  const ts = series
    .flatMap((s) => s.points.map((p) => p.t))
    .concat(o.band?.points.map((p) => p.t) ?? []);
  const vs = series
    .flatMap((s) => s.points.map((p) => p.v))
    .concat(o.band ? o.band.points.flatMap((p) => [p.lo, p.hi]) : []);
  let t0 = Math.min(...ts);
  let t1 = Math.max(...ts);
  if (t1 - t0 < DAY) {
    t0 -= DAY * 3;
    t1 += DAY * 3;
  }
  const vMin = Math.min(...vs);
  const vMax = Math.max(...vs);
  const pad = (vMax - vMin) * 0.12 || Math.abs(vMax) * 0.02 || 1;
  const ticks = niceTicks(vMin - pad, vMax + pad, 4);
  const lo = ticks[0];
  const hi = ticks[ticks.length - 1];

  let top = box.y;
  if (o.title) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(PDF_TYPE.small);
    setColor(doc, PDF_COLOR.ink, "text");
    doc.text(pdfText(o.title), box.x, top + 8);
    top += 16;
  }
  const legendH = o.legend === false ? 0 : 16;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(PDF_TYPE.caption);
  const tickText = (v: number) => pdfNumber(v, decimals);
  const axisW = Math.max(...ticks.map((v) => doc.getTextWidth(tickText(v)))) + 8;
  const plot = {
    x: box.x + axisW,
    y: top + 4,
    w: box.w - axisW - 4,
    h: box.h - (top - box.y) - 4 - 16 - legendH,
  };
  const X = (t: number) => plot.x + ((t - t0) / (t1 - t0)) * plot.w;
  const Y = (v: number) => plot.y + plot.h - ((v - lo) / (hi - lo || 1)) * plot.h;

  // grid + y ticks
  doc.setLineWidth(0.4);
  setColor(doc, PDF_COLOR.line, "draw");
  setColor(doc, PDF_COLOR.faint, "text");
  for (const v of ticks) {
    const y = Y(v);
    doc.line(plot.x, y, plot.x + plot.w, y);
    doc.text(tickText(v), plot.x - 6, y + 2.5, { align: "right" });
  }
  // x labels: start, end and evenly between
  const spanDays = (t1 - t0) / DAY;
  const n = spanDays > 60 ? 5 : spanDays > 14 ? 4 : 3;
  const showYear = new Date(t0).getFullYear() !== new Date(t1).getFullYear();
  for (let i = 0; i < n; i++) {
    const t = t0 + ((t1 - t0) * i) / (n - 1);
    const label = pdfDate(new Date(t), { year: showYear ? "always" : "never" });
    doc.text(label, X(t), plot.y + plot.h + 11, {
      align: i === 0 ? "left" : i === n - 1 ? "right" : "center",
    });
  }

  // band
  if (o.band && o.band.points.length > 1) {
    const pts = o.band.points.slice().sort((a, b) => a.t - b.t);
    const poly: Array<[number, number]> = [
      ...pts.map((p) => [X(p.t), Y(p.hi)] as [number, number]),
      ...pts
        .slice()
        .reverse()
        .map((p) => [X(p.t), Y(p.lo)] as [number, number]),
    ];
    withOpacity(doc, o.band.opacity ?? 0.13, () => {
      setColor(doc, o.band!.color, "fill");
      const [sx, sy] = poly[0];
      const rel = poly.slice(1).map(([x, y], i) => [x - poly[i][0], y - poly[i][1]]);
      doc.lines(rel, sx, sy, [1, 1], "F", true);
    });
  }

  // markers (a plan change): a dashed vertical line with a label at its top
  for (const m of o.markers ?? []) {
    if (m.t < t0 || m.t > t1) continue;
    const x = X(m.t);
    doc.setLineWidth(0.5);
    setColor(doc, PDF_COLOR.lineStrong, "draw");
    doc.setLineDashPattern([2, 2], 0);
    doc.line(x, plot.y, x, plot.y + plot.h);
    doc.setLineDashPattern([], 0);
    doc.setFontSize(PDF_TYPE.caption);
    setColor(doc, PDF_COLOR.muted, "text");
    doc.text(
      pdfText(m.label),
      Math.min(x + 3, plot.x + plot.w - doc.getTextWidth(pdfText(m.label))),
      plot.y + 7,
    );
  }

  // series
  for (const s of series) {
    const pts = s.points.slice().sort((a, b) => a.t - b.t);
    setColor(doc, s.color, "draw");
    setColor(doc, s.color, "fill");
    if (!s.dotsOnly && pts.length > 1) {
      doc.setLineWidth(s.width ?? 1.4);
      if (s.dash) doc.setLineDashPattern(s.dash, 0);
      doc.setLineJoin("round");
      doc.setLineCap("round");
      for (let i = 1; i < pts.length; i++)
        doc.line(X(pts[i - 1].t), Y(pts[i - 1].v), X(pts[i].t), Y(pts[i].v));
      if (s.dash) doc.setLineDashPattern([], 0);
    }
    if (s.dots || s.dotsOnly || pts.length === 1) {
      const r = s.dotsOnly ? 1.35 : 1.8;
      for (const p of pts) doc.circle(X(p.t), Y(p.v), r, "F");
    }
  }

  // legend
  if (legendH) {
    let lx = box.x + axisW;
    const ly = box.y + box.h - 4;
    doc.setFontSize(PDF_TYPE.caption);
    const items = series.map((s) => ({
      s,
      value:
        s.legendValue !== undefined
          ? s.legendValue
          : `${pdfNumber(s.points[s.points.length - 1].v, decimals)}${o.unit ? ` ${o.unit}` : ""}`,
    }));
    if (o.band?.label)
      items.push({ s: { label: o.band.label, points: [], color: o.band.color }, value: null });
    for (const { s, value } of items) {
      setColor(doc, s.color, "fill");
      if (!s.points.length) withOpacity(doc, 0.25, () => doc.rect(lx, ly - 6, 10, 7, "F"));
      else if (s.dotsOnly) doc.circle(lx + 5, ly - 2.5, 1.8, "F");
      else doc.rect(lx, ly - 3.4, 10, 1.8, "F");
      doc.setFont("helvetica", "normal");
      setColor(doc, PDF_COLOR.muted, "text");
      const label = pdfText(s.label);
      doc.text(label, lx + 14, ly);
      let w = 14 + doc.getTextWidth(label);
      if (value) {
        doc.setFont("helvetica", "bold");
        setColor(doc, PDF_COLOR.ink, "text");
        doc.text(pdfText(value), lx + w + 4, ly);
        w += 4 + doc.getTextWidth(pdfText(value));
      }
      lx += w + 16;
    }
  }
  return true;
}

export type Bar = { label: string; value: number; target?: number | null; highlight?: boolean };

/** Vertical bars (a week each), the target as a short dark line across its bar, values printed over the bars. */
export function drawBarChart(
  doc: jsPDF,
  box: Box,
  o: {
    bars: Bar[];
    unit?: string;
    title?: string | null;
    targetLabel?: string;
    valueLabels?: boolean;
    color?: RGB;
  },
): boolean {
  const bars = o.bars.filter((b) => Number.isFinite(b.value));
  if (!bars.length) return false;
  let top = box.y;
  if (o.title) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(PDF_TYPE.small);
    setColor(doc, PDF_COLOR.ink, "text");
    doc.text(pdfText(o.title), box.x, top + 8);
    top += 16;
  }
  const hasTarget = bars.some((b) => b.target != null);
  const legendH = hasTarget ? 14 : 0;
  const max = Math.max(...bars.map((b) => Math.max(b.value, b.target ?? 0)), 1);
  const ticks = niceTicks(0, max * 1.08, 4);
  const hi = ticks[ticks.length - 1];
  doc.setFont("helvetica", "normal");
  doc.setFontSize(PDF_TYPE.caption);
  const axisW = Math.max(...ticks.map((v) => doc.getTextWidth(pdfNumber(v, 0)))) + 8;
  const plot = {
    x: box.x + axisW,
    y: top + 4,
    w: box.w - axisW - 4,
    h: box.h - (top - box.y) - 4 - 15 - legendH,
  };
  const Y = (v: number) => plot.y + plot.h - (v / hi) * plot.h;
  doc.setLineWidth(0.4);
  setColor(doc, PDF_COLOR.line, "draw");
  setColor(doc, PDF_COLOR.faint, "text");
  for (const v of ticks) {
    doc.line(plot.x, Y(v), plot.x + plot.w, Y(v));
    doc.text(pdfNumber(v, 0), plot.x - 6, Y(v) + 2.5, { align: "right" });
  }
  const slot = plot.w / bars.length;
  const bw = Math.min(28, slot * 0.62);
  const every = Math.ceil(bars.length / Math.max(1, Math.floor(plot.w / 34)));
  bars.forEach((b, i) => {
    const cx = plot.x + slot * i + slot / 2;
    const y = Y(b.value);
    // the week in progress in ink, the rest grey; never the brand red (red means a problem)
    setColor(doc, b.highlight ? PDF_COLOR.ink : (o.color ?? [150, 154, 163]), "fill");
    if (b.value > 0) doc.rect(cx - bw / 2, y, bw, plot.y + plot.h - y, "F");
    if (b.target != null) {
      doc.setLineWidth(1.4);
      setColor(doc, PDF_COLOR.ink, "draw");
      doc.line(cx - bw / 2 - 2, Y(b.target), cx + bw / 2 + 2, Y(b.target));
    }
    if (o.valueLabels !== false && bars.length <= 16 && b.value > 0) {
      doc.setFontSize(PDF_TYPE.caption);
      setColor(doc, PDF_COLOR.body, "text");
      doc.text(pdfNumber(b.value, 0), cx, Math.min(y - 3, plot.y + plot.h - 3), {
        align: "center",
      });
    }
    if (i % every === 0) {
      setColor(doc, PDF_COLOR.faint, "text");
      doc.text(pdfText(b.label), cx, plot.y + plot.h + 11, { align: "center" });
    }
  });
  if (hasTarget) {
    const ly = box.y + box.h - 3;
    doc.setLineWidth(1.4);
    setColor(doc, PDF_COLOR.ink, "draw");
    doc.line(plot.x, ly - 3, plot.x + 10, ly - 3);
    setColor(doc, PDF_COLOR.muted, "text");
    doc.text(pdfText(o.targetLabel ?? "Planned"), plot.x + 14, ly);
  }
  return true;
}

/**
 * A chart on the page at the cursor: room for `height` first (or a new page),
 * then drawn across the content width (or `columns` charts side by side).
 */
export function chartRow(
  pdf: PdfDoc,
  height: number,
  draws: Array<(doc: jsPDF, box: Box) => boolean>,
  gapAfter = 14,
): void {
  const list = draws.filter(Boolean);
  if (!list.length) return;
  pdf.beforeContent(height);
  pdf.ensure(height);
  const gap = 18;
  const w = (pdf.contentWidth - gap * (list.length - 1)) / list.length;
  let drew = false;
  list.forEach((draw, i) => {
    drew = draw(pdf.doc, { x: 48 + i * (w + gap), y: pdf.y, w, h: height }) || drew;
  });
  if (drew) pdf.y += height + gapAfter;
}
