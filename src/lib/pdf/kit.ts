/**
 * The JF Effect PDF design system (Nov 22 2026): every training, nutrition
 * and report PDF the app makes is drawn with this, so they read as one
 * product.
 *
 * - One page: US Letter (Canada's paper), portrait unless a document's tables
 *   need the width (`orientationFor`), 48 pt side margins.
 * - One look: white paper, near-black ink, neutral greys, the brand red only
 *   for the document's eyebrow and one accent, green for done, amber for what
 *   needs a look, red for missed (the app's own colour rules). Helvetica, a
 *   short type scale with nothing under 7.5 pt, sentence case, hairline rules
 *   instead of boxes.
 * - A cover block on page 1 (logo, what it is, the title, who it's for, a row
 *   of facts), a running header on every page after it and a footer with
 *   "Page N of M" on every page, drawn last so the count is right.
 * - Tables (`table`) are kept together on one page when they fit (measured,
 *   never guessed: `measure` draws them on a scratch page first) and, when
 *   they don't, break between rows with their headers repeated and their
 *   title row saying "(continued)". Headings never sit alone at a page's foot
 *   (`keepWith`).
 * - Charts are vector (charts.ts), so they're sharp at any zoom and cost bytes,
 *   not pixels.
 *
 * Every string goes through `pdfText` (text.ts) on its way to the page.
 */
import { jsPDF } from "jspdf";
import autoTable, { type CellHookData, type RowInput, type UserOptions } from "jspdf-autotable";
import { pdfDate, pdfText } from "@/lib/pdf/text";

export type RGB = [number, number, number];

export const PDF_COLOR = {
  ink: [17, 17, 20] as RGB,
  body: [46, 48, 54] as RGB,
  muted: [104, 108, 118] as RGB,
  faint: [148, 151, 160] as RGB,
  line: [228, 230, 235] as RGB,
  lineStrong: [192, 195, 203] as RGB,
  surface: [246, 246, 248] as RGB,
  surfaceStrong: [236, 237, 241] as RGB,
  /** The app's primary red, oklch(0.62 0.22 25). */
  brand: [238, 52, 59] as RGB,
  good: [17, 125, 88] as RGB,
  goodSoft: [230, 244, 238] as RGB,
  warn: [168, 101, 0] as RGB,
  warnSoft: [252, 242, 222] as RGB,
  bad: [196, 38, 46] as RGB,
  badSoft: [252, 233, 234] as RGB,
} as const;

export type Tone = "neutral" | "good" | "warn" | "bad" | "brand" | "muted";

export function toneColor(t: Tone): RGB {
  return t === "good"
    ? PDF_COLOR.good
    : t === "warn"
      ? PDF_COLOR.warn
      : t === "bad"
        ? PDF_COLOR.bad
        : t === "brand"
          ? PDF_COLOR.brand
          : t === "muted"
            ? PDF_COLOR.muted
            : PDF_COLOR.ink;
}
function toneSoft(t: Tone): RGB {
  return t === "good"
    ? PDF_COLOR.goodSoft
    : t === "warn"
      ? PDF_COLOR.warnSoft
      : t === "bad"
        ? PDF_COLOR.badSoft
        : PDF_COLOR.surfaceStrong;
}

/** The type scale, pt. Nothing on a page is smaller than `caption`. */
export const PDF_TYPE = {
  display: 23,
  title: 15,
  heading: 12,
  subheading: 10.5,
  body: 9.75,
  table: 9,
  small: 8.25,
  caption: 7.5,
} as const;

export const PDF_PAGE = {
  format: "letter" as const,
  marginX: 48,
  /** Where content starts on pages after the cover (under the running header). */
  contentTop: 64,
  /** Room kept for the footer. */
  bottomGap: 58,
};

export type Orientation = "portrait" | "landscape";

/**
 * Portrait unless the widest table needs more than its width: each number is a
 * column's narrowest readable width, pt.
 */
export function orientationFor(minColumnWidths: number[]): Orientation {
  const portraitContent = 612 - PDF_PAGE.marginX * 2;
  return minColumnWidths.reduce((a, b) => a + b, 0) > portraitContent ? "landscape" : "portrait";
}

export type DocMeta = {
  /** What it is, the cover's eyebrow and the running header: "Training program". */
  kind: string;
  /** The cover's title: the program's, the plan's, "Progress report". */
  title: string;
  /** One line under the title: dates, the phase. */
  subtitle?: string | null;
  /** Who it's for (the running header and footer). */
  person?: string | null;
  /** The cover's row of facts, label over value. */
  facts?: Array<[string, string | null | undefined]>;
  generatedAt?: Date;
  orientation?: Orientation;
  /** The logo as a data URL (loadPdfLogo); left out, the wordmark stands alone. */
  logo?: string | null;
  compress?: boolean;
};

export type Col = {
  header: string;
  /** "auto" takes what's left; "fit" sizes to its longest text (up to `max`); a number is pt. */
  width?: number | "auto" | "fit";
  /** The most a "fit" column takes, pt (longer text wraps). */
  max?: number;
  align?: "left" | "center" | "right";
  /** A muted column (dates, small print). */
  muted?: boolean;
  bold?: boolean;
};

export type CellValue =
  | string
  | number
  | null
  | undefined
  | { content: string; colSpan?: number; styles?: Record<string, unknown> };

export type TableTitle = {
  text: string;
  /** The title when the table starts a page (or carries on onto one), with what the heading above it said: "Week 2 · Day 3 · Pull". */
  atPageTop?: string | null;
  /** Right side of the title row: a date, a status. */
  right?: string | null;
  rightTone?: Tone;
  /** A smaller line under the title, in the same row (a day's focus, a week's note). */
  sub?: string | null;
};

export type TableSpec = {
  columns: Col[];
  rows: CellValue[][];
  /** A title row inside the table, so it moves with it and repeats (continued) on a later page. */
  title?: TableTitle;
  /** Rows spanning every column under a row (notes): index of the row → text. Drawn muted and italic. */
  notes?: Map<number, string>;
  /** Smaller text for dense coach reports. */
  dense?: boolean;
  /** Keep the whole table on one page when it fits (default true). */
  keepTogether?: boolean;
  /** Tint one row (a total, a highlight). */
  emphasisRows?: Set<number>;
  /** Space after, pt. */
  gapAfter?: number;
  /** Colour a cell's text: (row, col) → tone. */
  cellTone?: (row: number, col: number) => Tone | null;
  /** Hide the column headers (a key–value table). */
  hideHeader?: boolean;
  /** A smaller muted line under a cell's text (an exercise's role under its name): "row:col" → text. */
  sub?: Map<string, string>;
  /** Lines under the last row, across every column (a day's note). */
  footnotes?: Array<string | null | undefined>;
  /** A column of empty tick boxes (a grocery list): its index. */
  checkColumn?: number;
};

const M = PDF_PAGE.marginX;

export class PdfDoc {
  readonly doc: jsPDF;
  readonly W: number;
  readonly H: number;
  readonly meta: DocMeta;
  readonly orientation: Orientation;
  y = 0;
  private finished = false;

  constructor(meta: DocMeta) {
    this.meta = meta;
    this.orientation = meta.orientation ?? "portrait";
    this.doc = new jsPDF({
      unit: "pt",
      format: PDF_PAGE.format,
      orientation: this.orientation,
      compress: meta.compress ?? true,
    });
    this.W = this.doc.internal.pageSize.getWidth();
    this.H = this.doc.internal.pageSize.getHeight();
    this.doc.setProperties({
      title: pdfText([meta.title, meta.person].filter(Boolean).join(" · ")),
      subject: pdfText(meta.kind),
      author: "JF Effect",
      creator: "JF Effect",
    });
    this.doc.setLineHeightFactor(1.32);
    this.cover();
  }

  /* ───────────── geometry ───────────── */

  get contentWidth(): number {
    return this.W - M * 2;
  }
  get bottom(): number {
    return this.H - PDF_PAGE.bottomGap;
  }
  get pageContentHeight(): number {
    return this.bottom - PDF_PAGE.contentTop;
  }
  get pageNumber(): number {
    return this.doc.getCurrentPageInfo().pageNumber;
  }

  newPage(): void {
    this.doc.addPage(PDF_PAGE.format, this.orientation);
    this.y = PDF_PAGE.contentTop;
  }

  /** Room for `need` pt here, or a new page. True when a page was added. */
  ensure(need: number): boolean {
    if (this.y + need > this.bottom) {
      this.newPage();
      return true;
    }
    return false;
  }

  gap(pt: number): void {
    this.y += pt;
  }

  /* ───────────── type ───────────── */

  font(
    style: "normal" | "bold" | "italic" | "bolditalic",
    size: number,
    color: RGB = PDF_COLOR.body,
  ): void {
    this.doc.setFont("helvetica", style);
    this.doc.setFontSize(size);
    this.doc.setTextColor(color[0], color[1], color[2]);
  }

  fill(c: RGB): void {
    this.doc.setFillColor(c[0], c[1], c[2]);
  }
  stroke(c: RGB, width = 0.5): void {
    this.doc.setDrawColor(c[0], c[1], c[2]);
    this.doc.setLineWidth(width);
  }

  /** Lines of `text` at the current font, wrapped to `width`. */
  wrap(text: string, width: number): string[] {
    return this.doc.splitTextToSize(pdfText(text), width) as string[];
  }

  /** One line cut to `width` with an ellipsis. */
  fit(text: string, width: number): string {
    const t = pdfText(text);
    if (this.doc.getTextWidth(t) <= width) return t;
    let lo = 0;
    let hi = t.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (this.doc.getTextWidth(`${t.slice(0, mid).trimEnd()}…`) <= width) lo = mid;
      else hi = mid - 1;
    }
    return `${t.slice(0, lo).trimEnd()}…`;
  }

  /** The widest of `texts` at a size, pt (for column widths kept the same across a block's tables). */
  textWidth(
    texts: Array<string | null | undefined>,
    size: number,
    style: "normal" | "bold" = "normal",
  ): number {
    this.doc.setFont("helvetica", style);
    this.doc.setFontSize(size);
    let w = 0;
    for (const t of texts)
      for (const line of pdfText(t ?? "").split("\n")) w = Math.max(w, this.doc.getTextWidth(line));
    return w;
  }

  lineHeight(size: number): number {
    return size * 1.36;
  }

  /* ───────────── the cover and the running chrome ───────────── */

  private drawLogo(x: number, y: number, size: number): boolean {
    if (!this.meta.logo) return false;
    try {
      this.doc.addImage(this.meta.logo, "PNG", x, y, size, size, "jf-logo", "FAST");
      return true;
    } catch {
      return false;
    }
  }

  private cover(): void {
    const d = this.doc;
    const top = 40;
    const hasLogo = this.drawLogo(M, top, 26);
    const wx = hasLogo ? M + 34 : M;
    this.font("bold", 11.5, PDF_COLOR.ink);
    d.text("JF Effect", wx, top + 12);
    this.font("normal", PDF_TYPE.caption, PDF_COLOR.faint);
    d.text("jfeffect.com", wx, top + 23);
    const made = pdfDate(this.meta.generatedAt ?? new Date());
    d.text(`Made ${made}`, this.W - M, top + 12, { align: "right" });

    let y = top + 64;
    this.font("bold", PDF_TYPE.small, PDF_COLOR.brand);
    d.text(pdfText(this.meta.kind), M, y);
    y += 10;
    this.font("bold", PDF_TYPE.display, PDF_COLOR.ink);
    const titleLines = this.wrap(this.meta.title, this.contentWidth).slice(0, 3);
    for (const l of titleLines) {
      y += PDF_TYPE.display * 1.12;
      d.text(l, M, y);
    }
    if (this.meta.subtitle) {
      this.font("normal", 10.5, PDF_COLOR.muted);
      y += 4;
      for (const l of this.wrap(this.meta.subtitle, this.contentWidth).slice(0, 2)) {
        y += 15;
        d.text(l, M, y);
      }
    }
    y += 18;
    const facts = (this.meta.facts ?? []).filter(
      ([, v]) => v != null && String(v).trim() !== "",
    ) as Array<[string, string]>;
    if (facts.length) {
      this.stroke(PDF_COLOR.line, 0.75);
      d.line(M, y, this.W - M, y);
      y += 14;
      const per = Math.min(4, facts.length);
      const colW = this.contentWidth / per;
      for (let i = 0; i < facts.length; i += per) {
        let rowH = 0;
        facts.slice(i, i + per).forEach(([label, value], j) => {
          const x = M + j * colW;
          this.font("normal", PDF_TYPE.caption, PDF_COLOR.muted);
          d.text(pdfText(label), x, y);
          this.font("bold", 10, PDF_COLOR.ink);
          const lines = this.wrap(value, colW - 12).slice(0, 3);
          lines.forEach((l, k) => d.text(l, x, y + 13 + k * 12.5));
          rowH = Math.max(rowH, 13 + lines.length * 12.5);
        });
        y += rowH + 8;
      }
      this.stroke(PDF_COLOR.line, 0.75);
      d.line(M, y, this.W - M, y);
      y += 6;
    }
    this.y = y + 16;
  }

  private chrome(): void {
    const d = this.doc;
    const pages = d.getNumberOfPages();
    const footerLeft = [this.meta.kind, this.meta.person].filter(Boolean).join(" · ");
    for (let i = 1; i <= pages; i++) {
      d.setPage(i);
      if (i > 1) {
        const hasLogo = this.drawLogo(M, 24, 13);
        const x = hasLogo ? M + 19 : M;
        this.font("bold", PDF_TYPE.caption + 0.5, PDF_COLOR.ink);
        d.text("JF Effect", x, 34);
        const w = d.getTextWidth("JF Effect");
        this.font("normal", PDF_TYPE.caption + 0.5, PDF_COLOR.muted);
        const right = pdfText(this.meta.person ?? "");
        const rightW = right ? d.getTextWidth(right) + 16 : 0;
        d.text(
          this.fit(`  ·  ${this.meta.title}`, this.contentWidth - (x - M) - w - rightW),
          x + w,
          34,
        );
        if (right) d.text(right, this.W - M, 34, { align: "right" });
        this.stroke(PDF_COLOR.line, 0.6);
        d.line(M, 44, this.W - M, 44);
      }
      this.stroke(PDF_COLOR.line, 0.6);
      d.line(M, this.H - 40, this.W - M, this.H - 40);
      this.font("normal", PDF_TYPE.caption, PDF_COLOR.faint);
      const pageLabel = `Page ${i} of ${pages}`;
      d.text(pageLabel, this.W - M, this.H - 27, { align: "right" });
      d.text(
        this.fit(footerLeft, this.contentWidth - d.getTextWidth(pageLabel) - 24),
        M,
        this.H - 27,
      );
    }
  }

  /* ───────────── blocks of content ───────────── */

  /**
   * A heading. Level 1 starts a section (it gets a rule), 2 a part of one, 3
   * a label. It never sits alone at a page's foot: `keepWith` is how much of
   * what follows must fit under it.
   */
  heading(
    text: string,
    opts: {
      level?: 1 | 2 | 3;
      keepWith?: number;
      right?: string | null;
      rightTone?: Tone;
      sub?: string | null;
      newPage?: boolean;
    } = {},
  ): void {
    const level = opts.level ?? 1;
    const size =
      level === 1 ? PDF_TYPE.title : level === 2 ? PDF_TYPE.heading : PDF_TYPE.subheading;
    const before = level === 1 ? 18 : level === 2 ? 12 : 8;
    const subLines = opts.sub
      ? this.wrapAt(opts.sub, "normal", PDF_TYPE.small, this.contentWidth)
      : [];
    const height =
      before +
      size +
      (level === 1 ? 16 : 7) +
      (subLines.length ? subLines.length * (this.lineHeight(PDF_TYPE.small) - 1) + 4 : 0);
    // Not drawn yet: it goes on the page with what follows it (`beforeContent`), so it never sits alone at a page's foot.
    this.pending.push({
      height,
      keepWith: opts.keepWith ?? 0,
      newPage: !!opts.newPage,
      draw: () => {
        const atTop = this.y <= PDF_PAGE.contentTop + 1;
        this.y += atTop ? 0 : before;
        const d = this.doc;
        const rightW = opts.right
          ? (this.font("bold", PDF_TYPE.small), d.getTextWidth(pdfText(opts.right)) + 12)
          : 0;
        this.font("bold", size, PDF_COLOR.ink);
        this.y += size;
        d.text(this.fit(text, this.contentWidth - rightW), M, this.y);
        if (opts.right) {
          this.font("bold", PDF_TYPE.small, toneColor(opts.rightTone ?? "muted"));
          d.text(pdfText(opts.right), this.W - M, this.y, { align: "right" });
        }
        this.y += level === 1 ? 6 : 3;
        if (subLines.length) {
          this.font("normal", PDF_TYPE.small, PDF_COLOR.muted);
          for (const l of subLines) {
            this.y += this.lineHeight(PDF_TYPE.small) - 1;
            d.text(l, M, this.y);
          }
          this.y += 4;
        }
        if (level === 1) {
          this.stroke(PDF_COLOR.ink, 0.9);
          d.line(M, this.y, this.W - M, this.y);
          this.y += 10;
        } else {
          this.y += 4;
        }
      },
    });
  }

  private pending: Array<{ height: number; keepWith: number; newPage: boolean; draw: () => void }> =
    [];

  /**
   * Called by everything that draws: the headings waiting go on the page with
   * at least `need` pt of what follows them (a new page first when there
   * isn't room, or when one asked to start a page).
   */
  beforeContent(need: number): void {
    if (!this.pending.length) return;
    const list = this.pending;
    this.pending = [];
    // a heading that starts a page splits the run: what came before it stays on this page
    let cut = -1;
    list.forEach((p, i) => {
      if (p.newPage) cut = i;
    });
    for (const p of cut > 0 ? list.slice(0, cut) : []) {
      this.ensure(p.height);
      p.draw();
    }
    const group = cut >= 0 ? list.slice(cut) : list;
    const follow = Math.max(need, group[group.length - 1].keepWith);
    if (cut >= 0 && this.y > PDF_PAGE.contentTop + 1) this.newPage();
    else
      this.ensure(
        Math.min(group.reduce((a, p) => a + p.height, 0) + follow, this.pageContentHeight),
      );
    for (const p of group) {
      this.ensure(p.height); // a long run of headings (weeks that repeat) still never runs off a page
      p.draw();
    }
  }

  private wrapAt(
    text: string,
    style: "normal" | "bold" | "italic",
    size: number,
    width: number,
  ): string[] {
    this.doc.setFont("helvetica", style);
    this.doc.setFontSize(size);
    return this.wrap(text, width);
  }

  /** Running text, wrapped and broken across pages a line at a time. Blank lines are paragraph breaks. */
  paragraph(
    text: string | null | undefined,
    opts: {
      size?: number;
      color?: RGB;
      style?: "normal" | "italic" | "bold";
      indent?: number;
      gapAfter?: number;
      width?: number;
    } = {},
  ): void {
    const clean = pdfText(text ?? "");
    if (!clean) return;
    const size = opts.size ?? PDF_TYPE.body;
    const lh = this.lineHeight(size);
    const indent = opts.indent ?? 0;
    const width = (opts.width ?? this.contentWidth) - indent;
    const paras = clean.split(/\n{2,}/);
    this.beforeContent(lh * 2);
    paras.forEach((p, pi) => {
      const lines = this.wrapAt(p, opts.style ?? "normal", size, width);
      // never one line alone at a page's foot
      this.ensure(Math.min(lines.length, 2) * lh);
      for (const line of lines) {
        this.ensure(lh);
        this.font(opts.style ?? "normal", size, opts.color ?? PDF_COLOR.body);
        this.y += lh;
        this.doc.text(line, M + indent, this.y - lh * 0.24);
      }
      if (pi < paras.length - 1) this.y += lh * 0.45;
    });
    this.y += opts.gapAfter ?? 6;
  }

  /** A list with bullets (or numbers), each item wrapped under itself. */
  bullets(
    items: Array<string | null | undefined>,
    opts: { size?: number; color?: RGB; numbered?: boolean; gapAfter?: number; marker?: RGB } = {},
  ): void {
    const list = items.map((i) => pdfText(i ?? "")).filter(Boolean);
    if (!list.length) return;
    const size = opts.size ?? PDF_TYPE.body;
    const lh = this.lineHeight(size);
    this.beforeContent(lh * 2);
    list.forEach((item, i) => {
      const lines = this.wrapAt(item, "normal", size, this.contentWidth - 14);
      this.ensure(Math.min(lines.length, 2) * lh);
      lines.forEach((line, k) => {
        this.ensure(lh);
        this.y += lh;
        if (k === 0) {
          this.font("bold", size, opts.marker ?? PDF_COLOR.faint);
          this.doc.text(opts.numbered ? `${i + 1}.` : "•", M, this.y - lh * 0.24);
        }
        this.font("normal", size, opts.color ?? PDF_COLOR.body);
        this.doc.text(line, M + 14, this.y - lh * 0.24);
      });
      this.y += 2.5;
    });
    this.y += opts.gapAfter ?? 6;
  }

  /**
   * A row of stat tiles: the value big, its label under it, an optional
   * small line. On a soft grey, never boxed. Wraps to more rows past `columns`.
   */
  tiles(
    items: Array<{ label: string; value: string; sub?: string | null; tone?: Tone }>,
    opts: { columns?: number; gapAfter?: number } = {},
  ): void {
    const list = items.filter((t) => t.value != null && String(t.value).trim() !== "");
    if (!list.length) return;
    const cols = Math.min(opts.columns ?? 4, list.length);
    const gap = 8;
    const w = (this.contentWidth - gap * (cols - 1)) / cols;
    this.beforeContent(58);
    for (let i = 0; i < list.length; i += cols) {
      const row = list.slice(i, i + cols);
      const subLines = row.map((t) =>
        t.sub ? this.wrapAt(t.sub, "normal", PDF_TYPE.caption, w - 20).slice(0, 2) : [],
      );
      const h = 50 + Math.max(0, ...subLines.map((s) => s.length)) * 9.5;
      this.ensure(h + 4);
      row.forEach((t, j) => {
        const x = M + j * (w + gap);
        this.fill(PDF_COLOR.surface);
        this.doc.roundedRect(x, this.y, w, h, 5, 5, "F");
        this.font("bold", 16, toneColor(t.tone ?? "neutral"));
        this.doc.text(this.fit(t.value, w - 20), x + 10, this.y + 23);
        this.font("normal", PDF_TYPE.caption, PDF_COLOR.muted);
        this.doc.text(this.fit(t.label, w - 20), x + 10, this.y + 37);
        subLines[j].forEach((l, k) => {
          this.font("normal", PDF_TYPE.caption, PDF_COLOR.faint);
          this.doc.text(l, x + 10, this.y + 48 + k * 9.5);
        });
      });
      this.y += h + gap;
    }
    this.y += (opts.gapAfter ?? 8) - gap;
  }

  /** Label · value pairs in two columns (a plan's details). */
  details(
    pairs: Array<[string, string | null | undefined]>,
    opts: { gapAfter?: number; labelWidth?: number } = {},
  ): void {
    const rows = pairs.filter(([, v]) => v != null && String(v).trim() !== "") as Array<
      [string, string]
    >;
    if (!rows.length) return;
    this.table({
      columns: [
        { header: "", width: opts.labelWidth ?? 120, muted: true },
        { header: "", width: "auto" },
      ],
      rows: rows.map(([l, v]) => [l, v]),
      hideHeader: true,
      gapAfter: opts.gapAfter,
    });
  }

  /** A soft panel with a title and words (a disclaimer, a safety note, a coach's summary). */
  callout(
    title: string | null,
    text: string,
    opts: { tone?: Tone; gapAfter?: number; size?: number } = {},
  ): void {
    const size = opts.size ?? PDF_TYPE.small;
    const lh = this.lineHeight(size);
    const lines = this.wrapAt(text, "normal", size, this.contentWidth - 28);
    const titleH = title ? 14 : 0;
    const full = 20 + titleH + lines.length * lh;
    const tone = opts.tone ?? "neutral";
    this.beforeContent(Math.min(full, 120));
    const draw = (from: number, to: number, withTitle: boolean) => {
      const h = 18 + (withTitle ? titleH : 0) + (to - from) * lh;
      this.fill(tone === "neutral" ? PDF_COLOR.surface : toneSoft(tone));
      this.doc.roundedRect(M, this.y, this.contentWidth, h, 5, 5, "F");
      if (tone !== "neutral") {
        this.fill(toneColor(tone));
        this.doc.rect(M, this.y, 2.5, h, "F");
      }
      let ty = this.y + 9;
      if (withTitle && title) {
        this.font("bold", size + 0.5, tone === "neutral" ? PDF_COLOR.ink : toneColor(tone));
        ty += size + 2;
        this.doc.text(pdfText(title), M + 14, ty);
        ty += 4;
      }
      this.font("normal", size, PDF_COLOR.body);
      for (let i = from; i < to; i++) {
        ty += lh;
        this.doc.text(lines[i], M + 14, ty - lh * 0.24);
      }
      this.y += h;
    };
    if (full <= this.pageContentHeight) {
      this.ensure(full);
      draw(0, lines.length, true);
    } else {
      // taller than a page: in page-sized pieces
      let i = 0;
      let first = true;
      while (i < lines.length) {
        this.ensure(18 + (first ? titleH : 0) + lh * 3);
        const room = Math.floor((this.bottom - this.y - 18 - (first ? titleH : 0)) / lh);
        const to = Math.min(lines.length, i + Math.max(1, room));
        draw(i, to, first);
        first = false;
        i = to;
        if (i < lines.length) this.newPage();
      }
    }
    this.y += opts.gapAfter ?? 10;
  }

  /** A small coloured label: "Completed", "Missed". */
  tag(label: string, x: number, baseline: number, tone: Tone): number {
    this.font("bold", PDF_TYPE.caption, toneColor(tone));
    const t = pdfText(label);
    const w = this.doc.getTextWidth(t) + 10;
    this.fill(toneSoft(tone));
    this.doc.roundedRect(x, baseline - 8, w, 11.5, 3, 3, "F");
    this.doc.text(t, x + 5, baseline);
    return w;
  }

  /** A hairline across the page. */
  rule(gapBefore = 4, gapAfter = 10): void {
    this.beforeContent(gapAfter);
    this.y += gapBefore;
    this.stroke(PDF_COLOR.line, 0.6);
    this.doc.line(M, this.y, this.W - M, this.y);
    this.y += gapAfter;
  }

  /* ───────────── tables ───────────── */

  private tableOptions(spec: TableSpec, startY: number, target: jsPDF): UserOptions {
    const dense = !!spec.dense;
    const size = dense ? PDF_TYPE.small : PDF_TYPE.table;
    const n = spec.columns.length;
    const columnStyles: NonNullable<UserOptions["columnStyles"]> = {};
    const pad = dense ? 10 : 12;
    const fitWidth = (i: number, c: Col) => {
      target.setFont("helvetica", "bold");
      target.setFontSize(PDF_TYPE.caption);
      let w = target.getTextWidth(pdfText(c.header));
      target.setFont("helvetica", c.bold ? "bold" : "normal");
      target.setFontSize(size);
      for (const r of spec.rows) {
        const v = r[i];
        if (v != null && typeof v === "object" && (v.colSpan ?? 1) > 1) continue;
        const text = pdfText(v != null && typeof v === "object" ? v.content : (v ?? "–"));
        for (const line of text.split("\n")) w = Math.max(w, target.getTextWidth(line));
      }
      return Math.min(c.max ?? 140, Math.ceil(w + pad + 1));
    };
    // Widths that add up to more than the page are shrunk, the fitted ones in proportion (each keeps at
    // least MIN_COL), leaving every "auto" column room to wrap: a table never runs off the page.
    const MIN_COL = 30;
    const AUTO_ROOM = 70;
    const widths: Array<number | "auto"> = spec.columns.map((c, i) =>
      c.width === "fit"
        ? fitWidth(i, c)
        : c.width === undefined || c.width === "auto"
          ? "auto"
          : c.width,
    );
    const autoCount = widths.filter((w) => w === "auto").length;
    const fixedSum = spec.columns.reduce(
      (a, c, i) =>
        a + (c.width !== "fit" && typeof widths[i] === "number" ? (widths[i] as number) : 0),
      0,
    );
    const fitIdx = spec.columns.map((c, i) => (c.width === "fit" ? i : -1)).filter((i) => i >= 0);
    const fitSum = fitIdx.reduce((a, i) => a + (widths[i] as number), 0);
    const room = this.contentWidth - autoCount * AUTO_ROOM - fixedSum;
    if (fitSum > room && fitIdx.length) {
      const k = Math.max(0, room) / fitSum;
      for (const i of fitIdx) widths[i] = Math.max(MIN_COL, Math.floor((widths[i] as number) * k));
    }
    // a table spans the page: with no flexible column, the widest takes what's left (autotable can't stretch fixed ones)
    if (!autoCount && widths.length) {
      let widest = 0;
      widths.forEach((w, i) => {
        if ((w as number) > (widths[widest] as number)) widest = i;
      });
      widths[widest] = "auto";
    }
    spec.columns.forEach((c, i) => {
      columnStyles[i] = {
        cellWidth: widths[i],
        halign: c.align ?? "left",
        ...(c.muted ? { textColor: PDF_COLOR.muted } : {}),
        ...(c.bold ? { fontStyle: "bold", textColor: PDF_COLOR.ink } : {}),
      };
    });
    const head: RowInput[] = [];
    const title = spec.title;
    if (title) {
      const right = title.right ? pdfText(title.right) : "";
      const sub = title.sub ? pdfText(title.sub) : "";
      // one cell across the table; the right side (a date, a status) is drawn into its padding (didDrawCell)
      target.setFont("helvetica", "bold");
      target.setFontSize(PDF_TYPE.small);
      const rightW = right ? target.getTextWidth(right) + 14 : 0;
      const titleCell = {
        content: pdfText(title.text) + (sub ? `\n${sub}` : ""),
        colSpan: n,
        styles: {
          fontStyle: "bold",
          fontSize: PDF_TYPE.subheading,
          textColor: PDF_COLOR.ink,
          cellPadding: { top: 2, right: rightW, bottom: 6, left: 0 },
          lineWidth: 0,
          valign: "top",
        },
      };
      const row: RowInput = [titleCell as never];
      head.push(row);
    }
    if (!spec.hideHeader) head.push(spec.columns.map((c) => pdfText(c.header)));

    const body: RowInput[] = [];
    const noteRows = new Set<number>();
    const noteFollows = new Set<number>();
    const bodyIndexOf: number[] = [];
    spec.rows.forEach((r, i) => {
      body.push(
        r.map((c, ci) => {
          const under = pdfText(spec.sub?.get(`${i}:${ci}`) ?? "");
          if (c != null && typeof c === "object")
            return { ...c, content: pdfText(c.content) + (under ? `\n${under}` : "") } as never;
          // null: nothing on file ("–"); "": nothing to say (left blank)
          const text = c == null ? "–" : pdfText(String(c));
          return under ? `${text}\n${under}` : text;
        }),
      );
      bodyIndexOf.push(i);
      const note = pdfText(spec.notes?.get(i) ?? "");
      if (note) {
        noteFollows.add(body.length - 1);
        noteRows.add(body.length);
        body.push([
          {
            content: note,
            colSpan: n,
            styles: {
              fontStyle: "italic",
              textColor: PDF_COLOR.muted,
              fontSize: size - 0.5,
              cellPadding: { top: 0, right: 6, bottom: 6, left: 6 },
            },
          } as never,
        ]);
        bodyIndexOf.push(i);
      }
    });
    for (const f of spec.footnotes ?? []) {
      const text = pdfText(f ?? "");
      if (!text) continue;
      noteRows.add(body.length);
      body.push([
        {
          content: text,
          colSpan: n,
          styles: {
            fontStyle: "normal",
            textColor: PDF_COLOR.muted,
            fontSize: size - 0.5,
            cellPadding: { top: 6, right: 6, bottom: 2, left: 6 },
          },
        } as never,
      ]);
      bodyIndexOf.push(-1);
    }
    const headRowsBefore = title ? 1 : 0;
    // a row and the note under it read as one: the rule goes under the note
    const lineBelow = (ri: number) => !noteFollows.has(ri) && bodyIndexOf[ri] !== -1;

    return {
      theme: "plain",
      startY,
      margin: {
        left: M,
        right: M,
        top: PDF_PAGE.contentTop,
        bottom: target.internal.pageSize.getHeight() - this.bottom,
      },
      head,
      body,
      showHead: "everyPage",
      rowPageBreak: "avoid",
      pageBreak: "auto",
      tableWidth: this.contentWidth,
      styles: {
        font: "helvetica",
        fontSize: size,
        textColor: PDF_COLOR.body,
        cellPadding: dense
          ? { top: 3.5, right: 5, bottom: 3.5, left: 5 }
          : { top: 5, right: 6, bottom: 5, left: 6 },
        overflow: "linebreak",
        valign: "top",
        lineColor: PDF_COLOR.line,
        lineWidth: 0,
        minCellHeight: 0,
      },
      headStyles: {
        fontStyle: "bold",
        fontSize: PDF_TYPE.caption,
        textColor: PDF_COLOR.muted,
        valign: "bottom",
        cellPadding: dense
          ? { top: 3, right: 5, bottom: 4, left: 5 }
          : { top: 4, right: 6, bottom: 5, left: 6 },
      },
      columnStyles,
      didParseCell: (data: CellHookData) => {
        if (data.section === "head" && data.row.index === headRowsBefore) {
          data.cell.styles.lineWidth = { top: 0, right: 0, bottom: 0.9, left: 0 };
          data.cell.styles.lineColor = PDF_COLOR.lineStrong;
        }
        if (data.section === "body") {
          const ri = data.row.index;
          if (lineBelow(ri))
            data.cell.styles.lineWidth = { top: 0, right: 0, bottom: 0.5, left: 0 };
          if (spec.emphasisRows?.has(bodyIndexOf[ri]) && !noteRows.has(ri)) {
            data.cell.styles.fillColor = PDF_COLOR.surface;
            data.cell.styles.fontStyle = "bold";
            data.cell.styles.textColor = PDF_COLOR.ink;
          }
          if (!noteRows.has(ri) && spec.cellTone) {
            const t = spec.cellTone(bodyIndexOf[ri], data.column.index);
            if (t) data.cell.styles.textColor = toneColor(t);
          }
        }
      },
      willDrawCell: (data: CellHookData) => {
        // the title row on a later page says so
        if (
          title &&
          data.section === "head" &&
          data.row.index === 0 &&
          data.column.index === 0 &&
          data.pageNumber > 1
        ) {
          const first = title.atPageTop
            ? pdfText(title.atPageTop)
            : String(data.cell.text[0] ?? "");
          if (!first.endsWith("(continued)"))
            data.cell.text = [`${first} (continued)`, ...data.cell.text.slice(1)];
        }
        // a sub line: the cell draws its own text, the muted lines are drawn after (didDrawCell)
        if (data.section === "body" && !noteRows.has(data.row.index)) {
          const under = pdfText(
            spec.sub?.get(`${bodyIndexOf[data.row.index]}:${data.column.index}`) ?? "",
          );
          if (under) {
            const doc = data.doc as jsPDF;
            doc.setFontSize(data.cell.styles.fontSize);
            const width = data.cell.width - data.cell.padding("horizontal");
            const subCount = (doc.splitTextToSize(under, width) as string[]).length;
            const keep = Math.max(1, data.cell.text.length - subCount);
            (data.cell as unknown as { _sub?: string[] })._sub = data.cell.text.slice(keep);
            data.cell.text = data.cell.text.slice(0, keep);
          }
        }
      },
      didDrawCell: (data: CellHookData) => {
        if (
          title?.right &&
          data.section === "head" &&
          data.row.index === 0 &&
          data.column.index === 0
        ) {
          const doc = data.doc as jsPDF;
          doc.setFont("helvetica", "bold");
          doc.setFontSize(PDF_TYPE.small);
          const c = toneColor(title.rightTone ?? "muted");
          doc.setTextColor(c[0], c[1], c[2]);
          // on the title's first line: its baseline sits about 0.8 of the title size under the cell's top padding
          doc.text(
            pdfText(title.right),
            data.cell.x + data.cell.width,
            data.cell.y + data.cell.padding("top") + PDF_TYPE.subheading * 0.86,
            { align: "right" },
          );
          return;
        }
        if (
          spec.checkColumn != null &&
          data.section === "body" &&
          data.column.index === spec.checkColumn &&
          !noteRows.has(data.row.index)
        ) {
          const doc = data.doc as jsPDF;
          const size = 8.5;
          doc.setDrawColor(
            PDF_COLOR.lineStrong[0],
            PDF_COLOR.lineStrong[1],
            PDF_COLOR.lineStrong[2],
          );
          doc.setLineWidth(0.8);
          doc.roundedRect(
            data.cell.x + data.cell.padding("left"),
            data.cell.y + data.cell.padding("top") + 1,
            size,
            size,
            1.5,
            1.5,
            "S",
          );
          return;
        }
        const sub = (data.cell as unknown as { _sub?: string[] })._sub;
        if (data.section !== "body" || !sub?.length) return;
        const doc = data.doc as jsPDF;
        const fs = data.cell.styles.fontSize;
        const lh = fs * doc.getLineHeightFactor();
        const mainLines = data.cell.text.length;
        doc.setFont("helvetica", "normal");
        doc.setFontSize(fs - 0.75);
        doc.setTextColor(PDF_COLOR.muted[0], PDF_COLOR.muted[1], PDF_COLOR.muted[2]);
        const x = data.cell.x + data.cell.padding("left");
        let y = data.cell.y + data.cell.padding("top") + lh * mainLines + (fs - 0.75) * 0.82;
        for (const l of sub) {
          doc.text(l, x, y);
          y += (fs - 0.75) * doc.getLineHeightFactor();
        }
      },
    };
  }

  /**
   * Height a table takes, pt, drawn on a scratch page from the top; Infinity
   * when it can't fit on one page.
   */
  measure(spec: TableSpec): number {
    const scratch = new jsPDF({
      unit: "pt",
      format: PDF_PAGE.format,
      orientation: this.orientation,
      compress: false,
    });
    scratch.setLineHeightFactor(1.32);
    autoTable(scratch, this.tableOptions(spec, PDF_PAGE.contentTop, scratch));
    if (scratch.getNumberOfPages() > 1) return Infinity;
    const finalY =
      (scratch as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ??
      PDF_PAGE.contentTop;
    return finalY - PDF_PAGE.contentTop;
  }

  /**
   * A table: kept whole on one page when it fits; else started here (with at
   * least its title and a couple of rows) and broken between rows, headers repeated.
   */
  table(spec: TableSpec, opts: { keepWith?: number } = {}): void {
    if (!spec.rows.length && !spec.footnotes?.some(Boolean)) return;
    const keep = spec.keepTogether !== false;
    if (this.pending.length) {
      // the heading over it moves with it: the whole table when it fits a page, else its first rows
      const waiting = this.pending.reduce((a, p) => a + p.height, 0);
      const h = keep ? this.measure(spec) : Infinity;
      this.beforeContent(h === Infinity ? 110 : Math.min(h, this.pageContentHeight - waiting));
    }
    if (keep) {
      const h = this.measure(spec);
      if (h !== Infinity && this.y + h + (opts.keepWith ?? 0) > this.bottom) this.newPage();
      else if (h === Infinity) this.ensure(110);
    } else {
      this.ensure(80);
    }
    // starting a page, the title says what the heading above it would have
    if (spec.title?.atPageTop && this.y <= PDF_PAGE.contentTop + 1)
      spec = { ...spec, title: { ...spec.title, text: spec.title.atPageTop } };
    autoTable(this.doc, this.tableOptions(spec, this.y, this.doc));
    const finalY =
      (this.doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ??
      this.y;
    this.y = finalY + (spec.gapAfter ?? 12);
  }

  /* ───────────── output ───────────── */

  /** Draws the running header and footer on every page; call once, last. */
  finish(): jsPDF {
    if (!this.finished) {
      this.beforeContent(0);
      this.chrome();
      this.finished = true;
    }
    return this.doc;
  }

  toBlob(): Blob {
    return this.finish().output("blob");
  }

  toFile(name: string): File {
    return new File([this.toBlob()], name, { type: "application/pdf" });
  }

  toBytes(): Uint8Array {
    return new Uint8Array(this.finish().output("arraybuffer"));
  }
}
