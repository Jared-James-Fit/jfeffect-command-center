import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

function safe(s: any): string {
  return String(s ?? "").replace(/[^\x20-\x7E]/g, "?");
}

export async function generateLibraryPdf(plan: any): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const margin = 50;
  const pageWidth = 595.28;
  const pageHeight = 841.89;
  const usable = pageWidth - margin * 2;
  let page = doc.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margin;

  const ensure = (need: number) => {
    if (y - need < margin) {
      page = doc.addPage([pageWidth, pageHeight]);
      y = pageHeight - margin;
    }
  };
  const draw = (text: string, opts: { size?: number; bold?: boolean; color?: [number,number,number]; indent?: number } = {}) => {
    const size = opts.size ?? 11;
    const f = opts.bold ? bold : font;
    const color = opts.color ?? [0.15,0.15,0.15];
    const words = safe(text).split(/\s+/);
    let line = "";
    const maxWidth = usable - (opts.indent ?? 0);
    for (const w of words) {
      const candidate = line ? line + " " + w : w;
      if (f.widthOfTextAtSize(candidate, size) > maxWidth) {
        ensure(size + 4);
        page.drawText(line, { x: margin + (opts.indent ?? 0), y, size, font: f, color: rgb(color[0],color[1],color[2]) });
        y -= size + 3;
        line = w;
      } else {
        line = candidate;
      }
    }
    if (line) {
      ensure(size + 4);
      page.drawText(line, { x: margin + (opts.indent ?? 0), y, size, font: f, color: rgb(color[0],color[1],color[2]) });
      y -= size + 3;
    }
  };
  const gap = (n = 6) => { y -= n; };

  // Header
  page.drawRectangle({ x: 0, y: pageHeight - 30, width: pageWidth, height: 30, color: rgb(0.06,0.06,0.08) });
  page.drawText("JF Effect", { x: margin, y: pageHeight - 22, size: 12, font: bold, color: rgb(1,1,1) });
  page.drawText("Membership Workout Library", { x: pageWidth - margin - 180, y: pageHeight - 22, size: 10, font, color: rgb(0.8,0.8,0.85) });
  y = pageHeight - 60;

  draw(plan.public_title || plan.name, { size: 22, bold: true });
  gap(2);
  draw(`${plan.training_style ?? ""}  ·  ${plan.difficulty ?? ""}  ·  ${plan.weeks}w / ${plan.days_per_week}d per week`, { size: 10, color: [0.4,0.4,0.45] });
  gap(8);
  if (plan.description) { draw(plan.description, { size: 11 }); gap(8); }
  if (Array.isArray(plan.equipment_needed) && plan.equipment_needed.length) {
    draw(`Equipment: ${plan.equipment_needed.join(", ")}`, { size: 10, color: [0.35,0.35,0.4] });
    gap(6);
  }
  if (plan.goal) { draw(`Goal: ${plan.goal}`, { size: 10, color: [0.35,0.35,0.4] }); gap(6); }
  gap(4);

  const payload = plan.published_payload ?? {};
  const weeks = Array.isArray(payload.weeks_data) ? payload.weeks_data : [];
  for (const w of weeks) {
    ensure(30);
    draw(`Week ${w.week_index}`, { size: 14, bold: true });
    const days = Array.isArray(w.days) ? w.days : [];
    for (const d of days) {
      ensure(20);
      draw(`${d.title || `Day ${d.day_index}`}`, { size: 12, bold: true, indent: 10 });
      const rows = Array.isArray(d.rows) ? d.rows : [];
      if (rows.length === 0) {
        draw("Rest / no exercises", { size: 10, color: [0.5,0.5,0.55], indent: 20 });
      } else {
        for (const r of rows) {
          const name = r.exercise_name || r.name || "Exercise";
          const sets = r.sets ?? r.target_sets ?? "";
          const reps = r.reps ?? r.target_reps ?? "";
          const rpe  = r.rpe != null ? `  RPE ${r.rpe}` : (r.rir != null ? `  RIR ${r.rir}` : "");
          const rest = r.rest_seconds ? `  rest ${r.rest_seconds}s` : "";
          draw(`• ${name}${sets || reps ? `  —  ${sets}${reps ? "×"+reps : ""}` : ""}${rpe}${rest}`, { size: 10, indent: 20 });
          if (r.notes) draw(r.notes, { size: 9, color: [0.45,0.45,0.5], indent: 28 });
        }
      }
      gap(4);
    }
    gap(8);
  }

  return await doc.save();
}