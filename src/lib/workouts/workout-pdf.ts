import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

type Row = {
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
};

type Day = {
  id: string;
  day_index: number;
  title?: string | null;
  notes?: string | null;
  notes_client_visible?: boolean | null;
  scheduled_date?: string | null;
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