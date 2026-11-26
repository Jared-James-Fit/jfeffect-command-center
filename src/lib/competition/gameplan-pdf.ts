/**
 * The meet-day gameplan as a phone-first PDF (Nov 26 2026). Unlike the app's
 * US Letter reports (src/lib/pdf), this one is read on a phone in a warm-up
 * room, so the page is a phone's shape (5.5 × 11 in) with large text: it
 * shows at full width on a phone with no zooming. One design system still:
 * the PDF standard Helvetica through `pdfText`, the app's colours, no
 * decoration. In order: version and approval (one line), key timings,
 * attempts, each lift's warm-up table (kept on one page), racks and equipment,
 * the final checklist, contacts and logistics. Deterministic from one gameplan
 * version, so a version's PDF is always the same and an outdated one says so.
 */
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { PDF_COLOR } from "@/lib/pdf/kit";
import { pdfFileName, pdfText } from "@/lib/pdf/text";
import { clock, type Timeline } from "./event-timeline";
import { LIFTS, rackText, type GameplanDoc } from "./gameplan";
import type { PrepItem } from "./prep-checklist";
import { toLb } from "./rules";

export const PHONE_PAGE: [number, number] = [396, 792];
const M = 22;
const WORD = { squat: "Squat", bench: "Bench", deadlift: "Deadlift" } as const;

export type GameplanPdfInput = {
  athlete: string;
  meet: string;
  date: string;
  location: string | null;
  zone: string;
  version: number | null;
  status: "approved" | "draft" | "cleo";
  approvedAt: string | null;
  updatedAt: string | null;
  /** a newer version is current: the PDF says so at the top */
  outdatedBy?: number | null;
  plan: GameplanDoc;
  timeline: Timeline;
  checklist: PrepItem[];
};

const day = (iso: string | null | undefined) =>
  iso
    ? new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso).toLocaleDateString("en-CA", {
        month: "short",
        day: "numeric",
        ...(iso.length === 10 ? { timeZone: "UTC" } : {}),
      })
    : "";

/** The PDF as a File, ready for the share sheet. */
export function buildGameplanPdf(x: GameplanPdfInput): File {
  const doc = new jsPDF({ unit: "pt", format: PHONE_PAGE, orientation: "portrait", compress: true });
  const W = PHONE_PAGE[0];
  const H = PHONE_PAGE[1];
  const bottom = H - 34;
  let y = M + 6;
  const t = (s: unknown) => pdfText(s);
  const font = (size: number, style: "normal" | "bold" = "normal", color = PDF_COLOR.ink) => {
    doc.setFont("helvetica", style);
    doc.setFontSize(size);
    doc.setTextColor(color[0], color[1], color[2]);
  };
  const ensure = (need: number) => {
    if (y + need > bottom) {
      doc.addPage(PHONE_PAGE, "portrait");
      y = M + 6;
    }
  };
  const heading = (text: string, need = 60) => {
    ensure(need);
    font(15, "bold");
    doc.text(t(text), M, y + 12);
    y += 22;
  };
  const line = (text: string, size = 12.5, color = PDF_COLOR.body, style: "normal" | "bold" = "normal") => {
    font(size, style, color);
    const rows = doc.splitTextToSize(t(text), W - M * 2) as string[];
    ensure(rows.length * size * 1.3);
    doc.text(rows, M, y + size);
    y += rows.length * size * 1.3 + 2;
  };
  const table = (head: string[] | null, body: string[][], opts: { widths?: number[]; size?: number; bold?: number[] } = {}) => {
    const size = opts.size ?? 13;
    const rowH = size * 1.9;
    const need = (body.length + (head ? 1 : 0)) * rowH + 8;
    // keep a short table (a lift's warm-ups) on one page
    if (need < bottom - (M + 6)) ensure(need);
    autoTable(doc, {
      startY: y,
      margin: { left: M, right: M },
      head: head ? [head.map(t)] : undefined,
      body: body.map((r) => r.map(t)),
      theme: "plain",
      styles: { font: "helvetica", fontSize: size, cellPadding: { top: 5, bottom: 5, left: 4, right: 4 }, textColor: PDF_COLOR.ink as any, lineColor: PDF_COLOR.line as any, lineWidth: { bottom: 0.6 } as any },
      headStyles: { fontSize: size - 3, textColor: PDF_COLOR.muted as any, fontStyle: "normal" },
      columnStyles: Object.fromEntries((opts.widths ?? []).map((w, i) => [i, { cellWidth: w, fontStyle: opts.bold?.includes(i) ? "bold" : "normal" }])),
      rowPageBreak: "avoid",
    });
    y = (doc as any).lastAutoTable.finalY + 10;
  };

  // ── version, approval, last updated (one line) ──
  if (x.outdatedBy) {
    doc.setFillColor(...PDF_COLOR.badSoft);
    doc.rect(0, 0, W, 26, "F");
    font(11, "bold", PDF_COLOR.bad);
    doc.text(t(`Outdated: version ${x.outdatedBy} is the current plan`), M, 17);
    y = 36;
  }
  font(10, "bold", PDF_COLOR.brand);
  doc.text("MEET-DAY GAMEPLAN", M, y + 8);
  y += 14;
  font(18, "bold");
  const title = doc.splitTextToSize(t(`${x.athlete} · ${x.meet}`), W - M * 2) as string[];
  doc.text(title, M, y + 16);
  y += title.length * 22 + 2;
  line(`${day(x.date)}${x.location ? ` · ${x.location}` : ""} · times in ${x.zone}`, 11.5, PDF_COLOR.muted);
  const ver =
    x.status === "approved"
      ? `Version ${x.version} · approved ${day(x.approvedAt)}${x.updatedAt ? ` · updated ${day(x.updatedAt)}` : ""}`
      : x.status === "draft"
        ? `Version ${x.version} · draft, not approved yet`
        : "Cleo's draft · not approved yet";
  line(ver, 11.5, x.status === "approved" ? PDF_COLOR.good : PDF_COLOR.warn);
  y += 4;

  // ── key timings ──
  const KEY = ["wake", "depart", "arrive", "weigh_in", "post_weigh_in_meal", "squat_warmup", "squat_1", "bench_warmup", "bench_1", "deadlift_warmup", "deadlift_1", "finish"];
  const timed = x.timeline.entries.filter((e) => KEY.includes(e.key));
  if (timed.length) {
    heading("Key timings");
    table(
      null,
      timed.map((e) => [
        e.at != null ? (e.from != null && e.to != null && e.to - e.from >= 5 ? `${clock(e.from)}-${clock(e.to).replace(/ (AM|PM)$/, "")}` : clock(e.at)) : (e.relative ?? "TBC"),
        e.label + (e.kind === "attempt" && e.kg != null ? ` · ${e.kg} kg` : ""),
        e.status === "confirmed" ? "" : e.status === "recommended" ? "plan" : "est.",
      ]),
      { widths: [104, W - M * 2 - 104 - 40, 40], bold: [0] },
    );
  }

  // ── attempts ──
  heading("Attempts", 120);
  const kgs = (v: number | null | undefined) => (v == null ? "-" : `${v}`);
  table(
    ["Lift", "Opener", "2nd", "3rd"],
    LIFTS.map((l) => {
      const a = x.plan.attempts[l];
      return [WORD[l], kgs(a?.opener), kgs(a?.second), kgs(a?.third)];
    }),
    { widths: [86, 86, 86, W - M * 2 - 258], size: 15, bold: [1] },
  );
  const lbs = LIFTS.map((l) => x.plan.attempts[l]?.opener).filter((v): v is number => v != null);
  if (lbs.length) line(`kg. Openers in lb: ${LIFTS.filter((l) => x.plan.attempts[l]?.opener != null).map((l) => `${WORD[l]} ${toLb(x.plan.attempts[l]!.opener!)}`).join(" · ")}`, 10.5, PDF_COLOR.muted);
  y += 2;

  // ── warm-ups, one table per lift, each kept together ──
  for (const l of LIFTS) {
    const rows = x.plan.warmups[l]?.rows ?? [];
    if (!rows.length) continue;
    const opener = x.plan.attempts[l]?.opener ?? null;
    const startAt = x.timeline.entries.find((e) => e.key === `${l}_warmup`)?.at ?? null;
    const need = (rows.length + 2) * 26 + 40;
    ensure(need);
    heading(`${WORD[l]} warm-ups${startAt != null ? ` · from ~${clock(startAt)}` : ""}`, need);
    table(
      ["kg", "lb", "Reps", "Before opener"],
      [
        ...rows.map((r) => [`${r.kg}`, `${toLb(r.kg)}`, `x${r.reps}`, r.minutesBefore != null ? `${r.minutesBefore} min` : ""]),
        ...(opener != null ? [[`${opener}`, `${toLb(opener)}`, "Opener", ""]] : []),
      ],
      { widths: [70, 70, 70, W - M * 2 - 210], size: 14, bold: [0] },
    );
  }

  // ── racks and equipment ──
  heading("Racks and equipment", 90);
  table(
    null,
    [
      ["Squat", rackText(x.plan.equipment.racks.squat) || "Not set"],
      ["Bench", rackText(x.plan.equipment.racks.bench) || "Not set"],
      ...(x.plan.equipment.gear.length ? [["Gear", x.plan.equipment.gear.join(", ")]] : []),
    ],
    { widths: [70, W - M * 2 - 70], bold: [0] },
  );

  // ── cues and their coach's notes (uploaded athlete information) ──
  const cueRows = (["squat", "bench", "deadlift"] as const)
    .filter((l) => x.plan.cues?.[l]?.length)
    .map((l) => [l[0].toUpperCase() + l.slice(1), x.plan.cues![l]!.join(" · ")]);
  if (cueRows.length || x.plan.instructions?.length) {
    heading("Cues and their coach's notes", 80);
    if (cueRows.length) table(null, cueRows, { widths: [70, W - M * 2 - 70], size: 13, bold: [0] });
    for (const s of x.plan.instructions ?? []) line(s, 12);
  }

  // ── final checklist ──
  const last = x.checklist.filter((i) => (i.stage === "day_before" || i.stage === "meet_day" || i.stage === "travel") && i.state !== "na");
  if (last.length) {
    heading("Final checklist", 80);
    table(
      null,
      last.map((i) => [i.state === "done" ? "[x]" : "[  ]", i.label + (i.priority === "critical" ? " *" : "")]),
      { widths: [34, W - M * 2 - 34], size: 12.5 },
    );
    line("* must-have", 10, PDF_COLOR.muted);
  }

  // ── food, fluids, contacts ──
  heading("The day", 80);
  for (const s of [...x.plan.day.afterWeighIn, ...x.plan.day.during]) line(s, 12.5);
  if (x.plan.day.caffeine) line(`Caffeine: ${x.plan.day.caffeine}`, 12.5);
  for (const s of x.plan.day.notes) line(s, 12, PDF_COLOR.muted);
  line("Never water or sodium tricks, saunas or a crash cut.", 10.5, PDF_COLOR.muted);
  if (x.plan.contacts.length) {
    heading("Contacts", 80);
    table(
      null,
      x.plan.contacts.map((c) => [`${c.name}\n${c.role}`, [c.phone, c.responsibility].filter(Boolean).join("\n")]),
      { widths: [130, W - M * 2 - 130], size: 12, bold: [0] },
    );
  }

  // ── footer ──
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    font(9, "normal", PDF_COLOR.faint);
    doc.text(t(`JF Effect · ${x.athlete} · ${x.meet}`), M, H - 14);
    doc.text(`${i} / ${pages}`, W - M, H - 14, { align: "right" });
  }
  const name = pdfFileName({ person: x.athlete, document: "meet gameplan", detail: x.version ? `v${x.version}` : "draft" });
  return new File([doc.output("blob")], name, { type: "application/pdf" });
}
