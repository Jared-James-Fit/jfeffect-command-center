import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

type Row = {
  id?: string;
  sort_order?: number | null;
  exercise_name_override?: string | null;
  exercises?: { name?: string | null } | null;
  sets?: number | null;
  reps_text?: string | null;
  rpe?: string | null;
  rir?: string | null;
  percentage?: number | null;
  percentage_basis?: string | null;
  load_kg?: number | null;
  load_lb?: number | null;
  rest_seconds?: number | null;
  tempo?: string | null;
  notes?: string | null;
  measurement_type?: string | null;
  duration_seconds?: number | null;
  /** Actual logged sets for this row, in set_index order. */
  logged_sets?: LoggedSet[];
};

export type LoggedSet = {
  set_index?: number | null;
  actual_reps?: number | null;
  actual_load?: number | null;
  actual_load_lb?: number | null;
  actual_load_kg?: number | null;
  actual_load_unit?: string | null;
  entered_value?: number | null;
  entered_unit?: string | null;
  normalized_lb?: number | null;
  normalized_kg?: number | null;
  actual_rpe?: string | number | null;
  actual_rpe_num?: string | number | null;
  actual_rir?: string | number | null;
  completed_duration_seconds?: number | null;
  notes?: string | null;
};

type Day = {
  id: string;
  day_index: number;
  title?: string | null;
  notes?: string | null;
  notes_client_visible?: boolean | null;
  scheduled_date?: string | null;
  started_at?: string | null;
  in_progress_at?: string | null;
  completed_at?: string | null;
  completion_note?: string | null;
  rows: Row[];
  /**
   * Client-authored exercise-level notes (pl_exercise_notes). Rendered as a
   * dedicated "Client exercise notes" section so coaches see them in every
   * downloaded PDF, not just inline per-set notes.
   */
  client_exercise_notes?: Array<{
    exercise_name?: string | null;
    content: string;
    status?: string | null;
    created_at?: string | null;
    updated_at?: string | null;
  }>;
};

type Week = {
  id: string;
  week_index: number;
  notes?: string | null;
  days: Day[];
};

export type WorkoutPdfData = {
  client_name?: string | null;
  program_name?: string | null;
  block_name?: string | null;
  block_status?: string | null;
  block_start?: string | null;
  block_end?: string | null;
  weeks: Week[];
};

export type FullTrainingReportBlock = {
  block_name?: string | null;
  block_status?: string | null;
  block_start?: string | null;
  block_end?: string | null;
  weeks: Week[];
};

export type FullTrainingReportData = {
  client_name?: string | null;
  generated_at?: Date;
  blocks: FullTrainingReportBlock[];
};

function fmtDate(iso?: string | null) {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

/**
 * jsPDF's default helvetica font is Latin-1 (Windows-1252) only. Emoji,
 * CJK, and other multi-byte characters render as tofu / random glyphs and
 * also break `getTextWidth`, which is why the status pill overlaps titles
 * containing emoji. Strip anything outside the printable Latin-1 range.
 */
function sanitizeText(s: string | null | undefined): string {
  if (!s) return "";
  return s
    // eslint-disable-next-line no-control-regex
    .replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/**
 * Coaches often name days "Day 5 — Primer". Combined with our own
 * `Day ${index}` prefix that yields "Day 5 — Day 5 — Primer". Strip any
 * leading "Day N", "D5", "Day 5:" style prefix that matches the current
 * day index.
 */
function normalizeDayTitle(title: string | null | undefined, index: number): string {
  const cleaned = sanitizeText(title);
  if (!cleaned) return "";
  const re = new RegExp(`^(?:day|d)\\s*0*${index}\\b[\\s\\-–—:.]*`, "i");
  return cleaned.replace(re, "").trim();
}

/** Distinct colors per week so long blocks are easy to skim. */
const WEEK_COLORS: [number, number, number][] = [
  [30, 64, 175],    // indigo
  [124, 58, 237],   // violet
  [16, 145, 91],    // emerald
  [217, 119, 6],    // amber
  [190, 24, 93],    // pink
  [8, 145, 178],    // cyan
  [220, 38, 38],    // red
  [5, 122, 85],     // teal
];
function weekColor(weekIndex: number): [number, number, number] {
  const idx = ((weekIndex - 1) % WEEK_COLORS.length + WEEK_COLORS.length) % WEEK_COLORS.length;
  return WEEK_COLORS[idx];
}

/** Block accent colors, cycled per block. */
const BLOCK_COLORS: [number, number, number][] = [
  [15, 23, 42],     // slate-900
  [67, 20, 7],      // deep brown
  [23, 37, 84],     // navy
  [59, 7, 100],     // deep purple
];
function blockColor(i: number): [number, number, number] {
  return BLOCK_COLORS[((i % BLOCK_COLORS.length) + BLOCK_COLORS.length) % BLOCK_COLORS.length];
}

function formatLoad(r: Row): string {
  if (r.percentage != null) {
    const basis = r.percentage_basis ? ` ${r.percentage_basis}` : "";
    return `${r.percentage}%${basis}`;
  }
  if (r.load_kg != null) return `${r.load_kg} kg`;
  if (r.load_lb != null) return `${r.load_lb} lb`;
  return "—";
}

function formatReps(r: Row): string {
  if (r.measurement_type === "time" && r.duration_seconds != null) {
    return `${r.duration_seconds}s`;
  }
  return (r.reps_text ?? "").trim() || "—";
}

function formatRpe(r: Row): string {
  if (r.rpe) return `RPE ${r.rpe}`;
  if (r.rir) return `RIR ${r.rir}`;
  return "—";
}

function formatRest(r: Row): string {
  if (r.rest_seconds == null) return "—";
  if (r.rest_seconds >= 60) {
    const m = Math.floor(r.rest_seconds / 60);
    const s = r.rest_seconds % 60;
    return s ? `${m}m ${s}s` : `${m}m`;
  }
  return `${r.rest_seconds}s`;
}

function formatLoggedLoad(s: LoggedSet): string {
  const enteredValue = s.entered_value ?? s.actual_load;
  if (enteredValue != null) {
    const unit = (s.entered_unit ?? s.actual_load_unit ?? "lb").toLowerCase();
    return `${enteredValue} ${unit}`;
  }
  if (s.actual_load_lb != null) return `${s.actual_load_lb} lb`;
  if (s.normalized_lb != null) return `${s.normalized_lb} lb`;
  if (s.actual_load_kg != null) return `${s.actual_load_kg} kg`;
  if (s.normalized_kg != null) return `${s.normalized_kg} kg`;
  return "—";
}

function formatLoggedRepsOrTime(s: LoggedSet): string {
  if (s.completed_duration_seconds != null && s.actual_reps == null) {
    return `${s.completed_duration_seconds}s`;
  }
  return s.actual_reps != null ? String(s.actual_reps) : "—";
}

function formatLoggedEffort(s: LoggedSet): string {
  const rpe = s.actual_rpe_num ?? s.actual_rpe;
  if (rpe != null && rpe !== "") return `RPE ${rpe}`;
  if (s.actual_rir != null && s.actual_rir !== "") return `RIR ${s.actual_rir}`;
  return "—";
}

function isWorkoutCompleted(day: Day): boolean {
  return !!day.completed_at;
}

function isWorkoutInProgress(day: Day): boolean {
  return !isWorkoutCompleted(day) && (!!day.started_at || !!day.in_progress_at || countLoggedSets(day) > 0);
}

function loggedSetHasInput(s: LoggedSet): boolean {
  const reps = s.actual_reps != null && Number.isFinite(Number(s.actual_reps)) && Number(s.actual_reps) > 0;
  const duration = s.completed_duration_seconds != null && Number.isFinite(Number(s.completed_duration_seconds)) && Number(s.completed_duration_seconds) > 0;
  const load =
    s.entered_value != null ||
    s.actual_load != null ||
    s.actual_load_lb != null ||
    s.actual_load_kg != null ||
    s.normalized_lb != null ||
    s.normalized_kg != null;
  const effort =
    (s.actual_rpe_num != null && s.actual_rpe_num !== "") ||
    (s.actual_rpe != null && s.actual_rpe !== "") ||
    (s.actual_rir != null && s.actual_rir !== "");
  const note = !!s.notes?.trim();
  return reps || duration || load || effort || note;
}

function countLoggedSets(day: Day): number {
  return day.rows.reduce((sum, row) => sum + (row.logged_sets ?? []).filter(loggedSetHasInput).length, 0);
}

function drawStatusPill(
  doc: jsPDF,
  label: string,
  x: number,
  y: number,
  fill: [number, number, number],
  text: [number, number, number] = [255, 255, 255],
) {
  const pillW = doc.getTextWidth(label) + 14;
  doc.setFillColor(...fill);
  doc.roundedRect(x - pillW, y - 11, pillW, 16, 4, 4, "F");
  doc.setTextColor(...text);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.text(label, x - pillW + 7, y);
}

export function generateWorkoutPdf(data: WorkoutPdfData): jsPDF {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = 36;
  let y = 48;

  // Brand bar
  doc.setFillColor(15, 15, 15);
  doc.rect(0, 0, pageWidth, 72, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.text("JF EFFECT", marginX, 36);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text("Workout Plan", marginX, 54);

  doc.setTextColor(20, 20, 20);
  y = 100;

  // Title
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text(data.block_name || data.program_name || "Training Block", marginX, y);
  y += 18;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(80, 80, 80);
  const metaLines: string[] = [];
  if (data.client_name) metaLines.push(`Athlete: ${data.client_name}`);
  if (data.program_name && data.program_name !== data.block_name) {
    metaLines.push(`Program: ${data.program_name}`);
  }
  const dateRange = [fmtDate(data.block_start), fmtDate(data.block_end)]
    .filter(Boolean)
    .join(" – ");
  if (dateRange) metaLines.push(dateRange);
  if (data.block_status) metaLines.push(`Status: ${data.block_status}`);
  const weekCount = data.weeks.length;
  if (weekCount) {
    const idxs = data.weeks.map((w) => w.week_index).sort((a, b) => a - b);
    metaLines.push(
      weekCount === 1
        ? `Week ${idxs[0]}`
        : `Weeks ${idxs[0]}–${idxs[idxs.length - 1]} (${weekCount} weeks)`,
    );
  }
  for (const line of metaLines) {
    doc.text(line, marginX, y);
    y += 13;
  }
  y += 6;

  const ensureSpace = (needed: number) => {
    if (y + needed > pageHeight - 60) {
      doc.addPage();
      y = 56;
    }
  };

  for (const week of data.weeks) {
    ensureSpace(60);
    const wc = weekColor(week.week_index);
    doc.setFillColor(...wc);
    doc.rect(marginX, y, pageWidth - marginX * 2, 22, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text(`Week ${week.week_index}`, marginX + 10, y + 15);
    y += 30;
    doc.setTextColor(20, 20, 20);

    if (week.notes?.trim()) {
      doc.setFont("helvetica", "italic");
      doc.setFontSize(9);
      doc.setTextColor(90, 90, 90);
      const lines = doc.splitTextToSize(sanitizeText(week.notes), pageWidth - marginX * 2);
      ensureSpace(lines.length * 11 + 6);
      doc.text(lines, marginX, y);
      y += lines.length * 11 + 6;
    }

    for (const day of week.days) {
      ensureSpace(50);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.setTextColor(...wc);
      const cleanTitle = normalizeDayTitle(day.title, day.day_index);
      const dayLabel =
        `Day ${day.day_index}` +
        (cleanTitle ? ` — ${cleanTitle}` : "") +
        (day.scheduled_date ? `  (${fmtDate(day.scheduled_date)})` : "");
      doc.text(sanitizeText(dayLabel), marginX, y);
      doc.setTextColor(20, 20, 20);
      y += 6;

      if (!day.rows || day.rows.length === 0) {
        y += 10;
        doc.setFont("helvetica", "italic");
        doc.setFontSize(9);
        doc.setTextColor(120, 120, 120);
        doc.text("Rest day / no exercises programmed.", marginX, y);
        y += 14;
        continue;
      }

      autoTable(doc, {
        startY: y + 6,
        head: [["#", "Exercise", "Sets", "Reps", "Load", "RPE/RIR", "Rest", "Tempo"]],
        body: day.rows
          .slice()
          .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
          .map((r, i) => [
            String(i + 1),
            sanitizeText(r.exercise_name_override) ||
              sanitizeText(r.exercises?.name) ||
              "Exercise",
            r.sets != null ? String(r.sets) : "—",
            formatReps(r),
            formatLoad(r),
            formatRpe(r),
            formatRest(r),
            sanitizeText(r.tempo) || "—",
          ]),
        styles: { fontSize: 8, cellPadding: 4 },
        headStyles: { fillColor: wc, textColor: 255 },
        columnStyles: {
          0: { cellWidth: 18 },
          1: { cellWidth: "auto" },
          2: { cellWidth: 32, halign: "center" },
          3: { cellWidth: 50, halign: "center" },
          4: { cellWidth: 60, halign: "center" },
          5: { cellWidth: 50, halign: "center" },
          6: { cellWidth: 42, halign: "center" },
          7: { cellWidth: 48, halign: "center" },
        },
        margin: { left: marginX, right: marginX },
        didDrawPage: (hook) => {
          y = hook.cursor?.y ?? y;
        },
      });
      y = (doc as any).lastAutoTable?.finalY ?? y;
      y += 6;

      // Per-row notes (client-visible by default; no row-level visibility flag exists)
      const noteRows = day.rows.filter((r) => r.notes?.trim());
      if (noteRows.length) {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8);
        doc.setTextColor(80, 80, 80);
        for (const r of noteRows) {
          const name = sanitizeText(r.exercise_name_override) || sanitizeText(r.exercises?.name) || "Exercise";
          const text = sanitizeText(`• ${name}: ${r.notes!.trim()}`);
          const lines = doc.splitTextToSize(text, pageWidth - marginX * 2);
          ensureSpace(lines.length * 10 + 2);
          doc.text(lines, marginX, y);
          y += lines.length * 10;
        }
        y += 4;
      }

      // Client-authored notes captured on the logged sets
      const setNotes: string[] = [];
      for (const r of day.rows) {
        for (const s of r.logged_sets ?? []) {
          const note = sanitizeText(s.notes);
          if (!note) continue;
          const name = sanitizeText(r.exercise_name_override) || sanitizeText(r.exercises?.name) || "Exercise";
          setNotes.push(`• ${name} — set ${s.set_index ?? "?"}: ${note}`);
        }
      }
      if (setNotes.length) {
        doc.setFont("helvetica", "bold");
        doc.setFontSize(8);
        doc.setTextColor(...wc);
        ensureSpace(14);
        doc.text("Client notes", marginX, y);
        y += 10;
        doc.setFont("helvetica", "normal");
        doc.setTextColor(70, 70, 70);
        for (const line of setNotes) {
          const wrapped = doc.splitTextToSize(line, pageWidth - marginX * 2);
          ensureSpace(wrapped.length * 10 + 2);
          doc.text(wrapped, marginX, y);
          y += wrapped.length * 10;
        }
        y += 4;
      }

      // Client-authored exercise-level notes (pl_exercise_notes) — shown even
      // when the client hasn't logged any sets on the day.
      const exNotes = (day.client_exercise_notes ?? []).filter((n) => sanitizeText(n.content));
      if (exNotes.length) {
        doc.setFont("helvetica", "bold");
        doc.setFontSize(8);
        doc.setTextColor(...wc);
        ensureSpace(14);
        doc.text("Client exercise notes", marginX, y);
        y += 10;
        doc.setFont("helvetica", "normal");
        doc.setTextColor(70, 70, 70);
        for (const n of exNotes) {
          const exName = sanitizeText(n.exercise_name) || "Exercise";
          const body = sanitizeText(n.content);
          const line = `• ${exName}: ${body}`;
          const wrapped = doc.splitTextToSize(line, pageWidth - marginX * 2);
          ensureSpace(wrapped.length * 10 + 2);
          doc.text(wrapped, marginX, y);
          y += wrapped.length * 10;
        }
        y += 4;
      }

      // Client completion note
      if (day.completion_note?.trim()) {
        doc.setFont("helvetica", "italic");
        doc.setFontSize(9);
        doc.setTextColor(60, 60, 60);
        const lines = doc.splitTextToSize(
          sanitizeText(`Client note: ${day.completion_note.trim()}`),
          pageWidth - marginX * 2,
        );
        ensureSpace(lines.length * 11 + 4);
        doc.text(lines, marginX, y);
        y += lines.length * 11 + 4;
      }

      // Day note — only when explicitly client-visible
      if (day.notes?.trim() && day.notes_client_visible !== false) {
        doc.setFont("helvetica", "italic");
        doc.setFontSize(9);
        doc.setTextColor(90, 90, 90);
        const lines = doc.splitTextToSize(
          sanitizeText(`Coach note: ${day.notes.trim()}`),
          pageWidth - marginX * 2,
        );
        ensureSpace(lines.length * 11 + 4);
        doc.text(lines, marginX, y);
        y += lines.length * 11 + 4;
      }

      y += 6;
    }

    y += 6;
  }

  // Footer on every page
  const pageCount = (doc as any).internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(140, 140, 140);
    doc.text("Generated from JF Effect Client Portal", marginX, pageHeight - 24);
    doc.text(`${i} / ${pageCount}`, pageWidth - marginX, pageHeight - 24, {
      align: "right",
    });
  }

  return doc;
}

export function downloadWorkoutPdf(data: WorkoutPdfData) {
  const doc = generateWorkoutPdf(data);
  const safeName = [data.client_name, data.block_name]
    .filter(Boolean)
    .join("-")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  doc.save(`${safeName || "workout-plan"}.pdf`);
}

/* ---------------------------------------------------------------------- */
/* Full training report — every block, every completed workout, with     */
/* prescribed sets AND the sets the athlete actually logged.              */
/* ---------------------------------------------------------------------- */

export function generateFullTrainingReportPdf(data: FullTrainingReportData): jsPDF {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = 36;
  let y = 48;

  // Cover / brand bar
  doc.setFillColor(15, 15, 15);
  doc.rect(0, 0, pageWidth, 90, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(22);
  doc.text("JF EFFECT", marginX, 40);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.text("Complete Training Report", marginX, 60);
  doc.setFontSize(9);
  const generated = data.generated_at ?? new Date();
  doc.text(
    `Generated ${generated.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}`,
    marginX,
    76,
  );

  doc.setTextColor(20, 20, 20);
  y = 120;

  if (data.client_name) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text(sanitizeText(`Athlete: ${data.client_name}`), marginX, y);
    y += 22;
  }

  // Overall totals
  let totalWorkouts = 0;
  let completedWorkouts = 0;
  for (const b of data.blocks) {
    for (const w of b.weeks) {
      for (const d of w.days) {
        totalWorkouts += 1;
        if (isWorkoutCompleted(d)) completedWorkouts += 1;
      }
    }
  }
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(80, 80, 80);
  doc.text(
    `${data.blocks.length} block${data.blocks.length === 1 ? "" : "s"}  ·  ${completedWorkouts} of ${totalWorkouts} workouts completed`,
    marginX,
    y,
  );
  y += 24;

  if (data.blocks.length) {
    autoTable(doc, {
      startY: y,
      head: [["Block", "Dates", "Status", "Completed"]],
      body: data.blocks.map((b) => {
        const blockTotal = b.weeks.reduce((sum, w) => sum + w.days.length, 0);
        const blockDone = b.weeks.reduce(
          (sum, w) => sum + w.days.filter(isWorkoutCompleted).length,
          0,
        );
        return [
          sanitizeText(b.block_name) || "Training Block",
          [fmtDate(b.block_start), fmtDate(b.block_end)].filter(Boolean).join(" – ") || "—",
          sanitizeText(b.block_status) || "—",
          `${blockDone}/${blockTotal}`,
        ];
      }),
      styles: { fontSize: 9, cellPadding: 5, overflow: "linebreak" },
      headStyles: { fillColor: [30, 30, 30], textColor: 255 },
      columnStyles: {
        0: { cellWidth: "auto", fontStyle: "bold" },
        1: { cellWidth: 120 },
        2: { cellWidth: 70 },
        3: { cellWidth: 70, halign: "center" },
      },
      margin: { left: marginX, right: marginX },
      didDrawPage: (hook) => {
        y = hook.cursor?.y ?? y;
      },
    });
    y = (doc as any).lastAutoTable?.finalY ?? y;
  }

  const ensureSpace = (needed: number) => {
    if (y + needed > pageHeight - 60) {
      doc.addPage();
      y = 56;
    }
  };

  for (let bi = 0; bi < data.blocks.length; bi++) {
    const b = data.blocks[bi];
    // Block header
    doc.addPage();
    y = 56;
    const bc = blockColor(bi);
    doc.setFillColor(...bc);
    doc.rect(0, 0, pageWidth, 46, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text(sanitizeText(b.block_name) || "Training Block", marginX, 28);
    doc.setTextColor(20, 20, 20);
    y = 68;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(80, 80, 80);
    const range = [fmtDate(b.block_start), fmtDate(b.block_end)].filter(Boolean).join(" – ");
    const bLines: string[] = [];
    if (range) bLines.push(range);
    if (b.block_status) bLines.push(`Status: ${b.block_status}`);
    let bDone = 0;
    let bTotal = 0;
    for (const w of b.weeks) for (const d of w.days) { bTotal++; if (isWorkoutCompleted(d)) bDone++; }
    bLines.push(`${bDone} of ${bTotal} workouts completed`);
    for (const line of bLines) { doc.text(line, marginX, y); y += 13; }
    y += 6;

    for (const week of b.weeks) {
      ensureSpace(50);
      const wc = weekColor(week.week_index);
      doc.setFillColor(...wc);
      doc.rect(marginX, y, pageWidth - marginX * 2, 20, "F");
      doc.setTextColor(255, 255, 255);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.text(`Week ${week.week_index}`, marginX + 10, y + 14);
      y += 34;
      doc.setTextColor(20, 20, 20);

      for (const day of week.days) {
        ensureSpace(82);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(11);
        doc.setTextColor(...wc);
        const completed = isWorkoutCompleted(day);
        const loggedCount = countLoggedSets(day);
        const inProgress = isWorkoutInProgress(day);
        const status = completed ? "COMPLETED" : inProgress ? "IN PROGRESS" : "NOT COMPLETED";
        const statusFill: [number, number, number] = completed
          ? [16, 145, 91]
          : inProgress
            ? [217, 119, 6]
            : [128, 128, 128];
        const cleanTitle = normalizeDayTitle(day.title, day.day_index);
        const dayLabelText = sanitizeText(
          `Day ${day.day_index}` +
            (cleanTitle ? ` — ${cleanTitle}` : "") +
            (day.scheduled_date ? `  (${fmtDate(day.scheduled_date)})` : ""),
        );
        const pillRight = pageWidth - marginX;
        const pillReservedWidth = Math.max(100, doc.getTextWidth(status) + 24);
        const availableWidth = pageWidth - marginX * 2 - pillReservedWidth - 8;
        const dayLines = doc.splitTextToSize(dayLabelText, availableWidth);
        doc.text(dayLines, marginX, y);
        drawStatusPill(doc, status, pillRight, y, statusFill);
        doc.setTextColor(20, 20, 20);

        y += Math.max(14, dayLines.length * 12);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(9);
        doc.setTextColor(90, 90, 90);
        const detailParts = [
          completed && day.completed_at ? `Completed ${fmtDate(day.completed_at)}` : null,
          loggedCount > 0 ? `${loggedCount} logged set${loggedCount === 1 ? "" : "s"}` : null,
        ].filter(Boolean);
        if (detailParts.length) {
          const detailLines = doc.splitTextToSize(detailParts.join("  ·  "), pageWidth - marginX * 2);
          doc.text(detailLines, marginX, y);
          y += detailLines.length * 11;
        }
        y += 4;

        if (!day.rows || day.rows.length === 0) {
          y += 10;
          doc.setFont("helvetica", "italic");
          doc.setFontSize(9);
          doc.setTextColor(120, 120, 120);
          doc.text("Rest day / no exercises programmed.", marginX, y);
          y += 14;
          continue;
        }

        const rowsSorted = day.rows
          .slice()
          .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));

        // Per-exercise: prescribed line + logged sets table
        for (let i = 0; i < rowsSorted.length; i++) {
          const r = rowsSorted[i];
          ensureSpace(72);
          const name =
            sanitizeText(r.exercise_name_override) || sanitizeText(r.exercises?.name) || "Exercise";
          doc.setFont("helvetica", "bold");
          doc.setFontSize(10);
          doc.setTextColor(20, 20, 20);
          y += 10;
          doc.text(`${i + 1}. ${name}`, marginX, y);
          y += 12;

          doc.setFont("helvetica", "normal");
          doc.setFontSize(9);
          doc.setTextColor(90, 90, 90);
          const prescribed = [
            r.sets != null ? `${r.sets} sets` : null,
            `× ${formatReps(r)}`,
            `@ ${formatLoad(r)}`,
            formatRpe(r) !== "—" ? formatRpe(r) : null,
            formatRest(r) !== "—" ? `rest ${formatRest(r)}` : null,
            r.tempo?.trim() ? `tempo ${r.tempo.trim()}` : null,
          ]
            .filter(Boolean)
            .join("  ");
          if (prescribed) {
            const plines = doc.splitTextToSize(
              sanitizeText(`Prescribed: ${prescribed}`),
              pageWidth - marginX * 2,
            );
            doc.text(plines, marginX, y);
            y += plines.length * 11 + 2;
          }

          const logged = (r.logged_sets ?? [])
            .filter(loggedSetHasInput)
            .slice()
            .sort((a, b) => (a.set_index ?? 0) - (b.set_index ?? 0));
          if (logged.length) {
            autoTable(doc, {
              startY: y + 2,
              head: [["Set", "Reps / Time", "Load", "RPE / RIR", "Note"]],
              body: logged.map((s, idx) => [
                String(s.set_index ?? idx + 1),
                formatLoggedRepsOrTime(s),
                formatLoggedLoad(s),
                formatLoggedEffort(s),
                sanitizeText(s.notes) || "—",
              ]),
              styles: { fontSize: 8, cellPadding: 3 },
              headStyles: { fillColor: wc, textColor: 255 },
              columnStyles: {
                0: { cellWidth: 30, halign: "center" },
                1: { cellWidth: 70, halign: "center" },
                2: { cellWidth: 70, halign: "center" },
                3: { cellWidth: 60, halign: "center" },
                4: { cellWidth: "auto" },
              },
              margin: { left: marginX, right: marginX },
              didDrawPage: (hook) => {
                y = hook.cursor?.y ?? y;
              },
            });
            y = (doc as any).lastAutoTable?.finalY ?? y;
            y += 6;
          } else if (completed) {
            doc.setFont("helvetica", "italic");
            doc.setFontSize(8);
            doc.setTextColor(140, 140, 140);
            doc.text("Completed workout — no sets logged for this exercise.", marginX, y);
            y += 12;
          } else {
            doc.setFont("helvetica", "italic");
            doc.setFontSize(8);
            doc.setTextColor(140, 140, 140);
            doc.text("Not completed yet.", marginX, y);
            y += 12;
          }

          if (r.notes?.trim()) {
            doc.setFont("helvetica", "italic");
            doc.setFontSize(8);
            doc.setTextColor(90, 90, 90);
            const nl = doc.splitTextToSize(
              sanitizeText(`Coach note: ${r.notes.trim()}`),
              pageWidth - marginX * 2,
            );
            ensureSpace(nl.length * 10 + 4);
            doc.text(nl, marginX, y);
            y += nl.length * 10 + 2;
          }
        }

        if (day.completion_note?.trim()) {
          doc.setFont("helvetica", "italic");
          doc.setFontSize(9);
          doc.setTextColor(60, 60, 60);
          const lines = doc.splitTextToSize(
            sanitizeText(`Client note: ${day.completion_note.trim()}`),
            pageWidth - marginX * 2,
          );
          ensureSpace(lines.length * 11 + 4);
          doc.text(lines, marginX, y);
          y += lines.length * 11 + 4;
        }

        if (day.notes?.trim() && day.notes_client_visible !== false) {
          doc.setFont("helvetica", "italic");
          doc.setFontSize(9);
          doc.setTextColor(90, 90, 90);
          const lines = doc.splitTextToSize(
            sanitizeText(`Coach day note: ${day.notes.trim()}`),
            pageWidth - marginX * 2,
          );
          ensureSpace(lines.length * 11 + 4);
          doc.text(lines, marginX, y);
          y += lines.length * 11 + 4;
        }

        y += 8;
      }

      y += 6;
    }
  }

  // Footer on every page
  const pageCount = (doc as any).internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(140, 140, 140);
    doc.text("Generated from JF Effect Client Portal", marginX, pageHeight - 24);
    doc.text(`${i} / ${pageCount}`, pageWidth - marginX, pageHeight - 24, {
      align: "right",
    });
  }

  return doc;
}

export function downloadFullTrainingReportPdf(data: FullTrainingReportData) {
  const doc = generateFullTrainingReportPdf(data);
  const safeName = [data.client_name, "training-report"]
    .filter(Boolean)
    .join("-")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  doc.save(`${safeName || "training-report"}.pdf`);
}