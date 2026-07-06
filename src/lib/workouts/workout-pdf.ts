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
  actual_load_unit?: string | null;
  actual_rpe?: string | number | null;
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
  completed_at?: string | null;
  completion_note?: string | null;
  rows: Row[];
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
  if (s.actual_load == null) return "—";
  const unit = (s.actual_load_unit ?? "lb").toLowerCase();
  return `${s.actual_load} ${unit}`;
}

function formatLoggedRepsOrTime(s: LoggedSet): string {
  if (s.completed_duration_seconds != null && s.actual_reps == null) {
    return `${s.completed_duration_seconds}s`;
  }
  return s.actual_reps != null ? String(s.actual_reps) : "—";
}

function formatLoggedEffort(s: LoggedSet): string {
  if (s.actual_rpe != null && s.actual_rpe !== "") return `RPE ${s.actual_rpe}`;
  if (s.actual_rir != null && s.actual_rir !== "") return `RIR ${s.actual_rir}`;
  return "—";
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
    doc.setFillColor(15, 15, 15);
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
      const lines = doc.splitTextToSize(week.notes.trim(), pageWidth - marginX * 2);
      ensureSpace(lines.length * 11 + 6);
      doc.text(lines, marginX, y);
      y += lines.length * 11 + 6;
    }

    for (const day of week.days) {
      ensureSpace(50);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.setTextColor(20, 20, 20);
      const dayLabel =
        `Day ${day.day_index}` +
        (day.title ? ` — ${day.title}` : "") +
        (day.scheduled_date ? `  (${fmtDate(day.scheduled_date)})` : "");
      doc.text(dayLabel, marginX, y);
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
            r.exercise_name_override?.trim() ||
              r.exercises?.name ||
              "Exercise",
            r.sets != null ? String(r.sets) : "—",
            formatReps(r),
            formatLoad(r),
            formatRpe(r),
            formatRest(r),
            r.tempo?.trim() || "—",
          ]),
        styles: { fontSize: 8, cellPadding: 4 },
        headStyles: { fillColor: [40, 40, 40], textColor: 255 },
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
          const name =
            r.exercise_name_override?.trim() || r.exercises?.name || "Exercise";
          const text = `• ${name}: ${r.notes!.trim()}`;
          const lines = doc.splitTextToSize(text, pageWidth - marginX * 2);
          ensureSpace(lines.length * 10 + 2);
          doc.text(lines, marginX, y);
          y += lines.length * 10;
        }
        y += 4;
      }

      // Day note — only when explicitly client-visible
      if (day.notes?.trim() && day.notes_client_visible !== false) {
        doc.setFont("helvetica", "italic");
        doc.setFontSize(9);
        doc.setTextColor(90, 90, 90);
        const lines = doc.splitTextToSize(
          `Note: ${day.notes.trim()}`,
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
    doc.text(`Athlete: ${data.client_name}`, marginX, y);
    y += 22;
  }

  // Overall totals
  let totalWorkouts = 0;
  let completedWorkouts = 0;
  for (const b of data.blocks) {
    for (const w of b.weeks) {
      for (const d of w.days) {
        totalWorkouts += 1;
        if (d.completed_at) completedWorkouts += 1;
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

  const ensureSpace = (needed: number) => {
    if (y + needed > pageHeight - 60) {
      doc.addPage();
      y = 56;
    }
  };

  for (const b of data.blocks) {
    // Block header
    doc.addPage();
    y = 56;
    doc.setFillColor(15, 15, 15);
    doc.rect(0, 0, pageWidth, 40, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text(b.block_name || "Training Block", marginX, 26);
    doc.setTextColor(20, 20, 20);
    y = 64;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(80, 80, 80);
    const range = [fmtDate(b.block_start), fmtDate(b.block_end)].filter(Boolean).join(" – ");
    const bLines: string[] = [];
    if (range) bLines.push(range);
    if (b.block_status) bLines.push(`Status: ${b.block_status}`);
    let bDone = 0;
    let bTotal = 0;
    for (const w of b.weeks) for (const d of w.days) { bTotal++; if (d.completed_at) bDone++; }
    bLines.push(`${bDone} of ${bTotal} workouts completed`);
    for (const line of bLines) { doc.text(line, marginX, y); y += 13; }
    y += 6;

    for (const week of b.weeks) {
      ensureSpace(50);
      doc.setFillColor(30, 30, 30);
      doc.rect(marginX, y, pageWidth - marginX * 2, 20, "F");
      doc.setTextColor(255, 255, 255);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.text(`Week ${week.week_index}`, marginX + 10, y + 14);
      y += 26;
      doc.setTextColor(20, 20, 20);

      for (const day of week.days) {
        ensureSpace(60);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(11);
        doc.setTextColor(20, 20, 20);
        const dayLabel =
          `Day ${day.day_index}` +
          (day.title ? ` — ${day.title}` : "") +
          (day.scheduled_date ? `  (${fmtDate(day.scheduled_date)})` : "");
        doc.text(dayLabel, marginX, y);

        // Status pill on the right
        const status = day.completed_at ? "COMPLETED" : "NOT COMPLETED";
        const pillW = doc.getTextWidth(status) + 12;
        const pillX = pageWidth - marginX - pillW;
        if (day.completed_at) {
          doc.setFillColor(16, 185, 129);
        } else {
          doc.setFillColor(200, 200, 200);
        }
        doc.roundedRect(pillX, y - 10, pillW, 14, 3, 3, "F");
        doc.setTextColor(255, 255, 255);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(8);
        doc.text(status, pillX + 6, y);
        doc.setTextColor(20, 20, 20);

        if (day.completed_at) {
          y += 12;
          doc.setFont("helvetica", "normal");
          doc.setFontSize(9);
          doc.setTextColor(90, 90, 90);
          doc.text(`Logged ${fmtDate(day.completed_at)}`, marginX, y);
        }
        y += 8;

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
            r.exercise_name_override?.trim() || r.exercises?.name || "Exercise";
          doc.setFont("helvetica", "bold");
          doc.setFontSize(10);
          doc.setTextColor(20, 20, 20);
          y += 14;
          doc.text(`${i + 1}. ${name}`, marginX, y);
          y += 6;

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
              `Prescribed: ${prescribed}`,
              pageWidth - marginX * 2,
            );
            y += 10;
            doc.text(plines, marginX, y);
            y += (plines.length - 1) * 11 + 4;
          }

          const logged = (r.logged_sets ?? [])
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
                (s.notes ?? "").trim() || "—",
              ]),
              styles: { fontSize: 8, cellPadding: 3 },
              headStyles: { fillColor: [40, 40, 40], textColor: 255 },
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
          } else if (day.completed_at) {
            doc.setFont("helvetica", "italic");
            doc.setFontSize(8);
            doc.setTextColor(140, 140, 140);
            doc.text("No sets logged for this exercise.", marginX, y + 10);
            y += 16;
          } else {
            y += 4;
          }

          if (r.notes?.trim()) {
            doc.setFont("helvetica", "italic");
            doc.setFontSize(8);
            doc.setTextColor(90, 90, 90);
            const nl = doc.splitTextToSize(
              `Coach note: ${r.notes.trim()}`,
              pageWidth - marginX * 2,
            );
            ensureSpace(nl.length * 10 + 4);
            doc.text(nl, marginX, y);
            y += nl.length * 10 + 2;
          }
        }

        if (day.notes?.trim() && day.notes_client_visible !== false) {
          doc.setFont("helvetica", "italic");
          doc.setFontSize(9);
          doc.setTextColor(90, 90, 90);
          const lines = doc.splitTextToSize(
            `Day note: ${day.notes.trim()}`,
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