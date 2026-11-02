import { describe, expect, it } from "vitest";
import { buildIntelReport } from "@/lib/program-intel/report";
import { CSV_COLUMNS, buildAiPrompt, csvCell, exportFileName, privacySafeRecords, reportToCsv, reportToJson, reportToMarkdown, scrubName } from "@/lib/program-intel/export";
import { buildIntelPdf } from "@/lib/program-intel/pdf";
import { fixture } from "./program-intel-fixture";

const rec = fixture({ client: { ...fixture().client, full_name: "Marc Tremblay", lifestyle_notes: "Works nights at the hospital" } });
const report = buildIntelReport(rec, { generatedAt: "2026-10-16T12:00:00Z" });

describe("Program Intelligence exports keep every record", () => {
  it("Markdown: every prescribed exercise and every logged set, prescribed apart from actual, facts apart from hypotheses", () => {
    const md = reportToMarkdown(report, rec, { privacySafe: false });
    // all nine prescribed exercises across the six days are listed
    expect(md.match(/  - Prescribed: /g)).toHaveLength(9);
    expect(md.match(/  - Actual: /g)).toHaveLength(9);
    // the partly logged squat day: 2 working sets plus the warm-up
    expect(md).toContain("Actual: S0 60kg×5 @4 (warm-up), S1 150kg×5 @8, S2 150kg×5 @8");
    expect(md).toContain("Prescribed: 3×5 @RPE 7");
    expect(md).toContain("**[FACT]** Competition Squat e1RM 177.5kg → 185kg (+4.3%)");
    expect(md).toContain("[MISSING DATA]");
    expect(md).toContain("data fingerprint " + report.dataHash);
    expect(md).toContain("nothing is truncated");
  });
  it("the AI prompt asks for facts vs hypotheses and the individual's response, and carries the whole report", () => {
    const p = buildAiPrompt(report, rec, { privacySafe: false });
    expect(p).toContain("FACTS (measured from the records");
    expect(p).toContain("HYPOTHESES");
    expect(p).toContain("not a generic template");
    expect(p).toContain("Analyze squat, bench press and deadlift independently");
    expect(p).toContain(reportToMarkdown(report, rec, { privacySafe: false }));
  });
  it("JSON: the raw records verbatim, the measured report and prescribed vs actual", () => {
    const j = JSON.parse(reportToJson(report, rec, { privacySafe: false }));
    expect(j.schema).toBe("jfeffect.program-intelligence/v1");
    expect(j.records.results).toHaveLength(rec.results.length);
    expect(j.records.rows).toHaveLength(rec.rows.length);
    expect(j.prescribed_vs_actual).toHaveLength(6);
    expect(j.report.findings.length).toBe(report.findings.length);
  });
  it("CSV: one line per logged set plus one per prescribed exercise with nothing logged, quoted safely", () => {
    const csv = reportToCsv(report).trim().split("\n");
    expect(csv[0]).toBe(CSV_COLUMNS.join(","));
    const loggedSets = rec.results.length; // 12
    const emptyRows = report.days.flatMap((d) => d.rows).filter((r) => !r.actual.some((s) => s.logged)).length; // 4
    expect(csv.length - 1).toBe(loggedSets + emptyRows);
    expect(csvCell('say "hi", ok')).toBe('"say ""hi"", ok"');
    expect(csvCell(null)).toBe("");
  });
  it("PDF builds with the full log", () => {
    const doc = buildIntelPdf(report, rec, { privacySafe: false });
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(2);
  });
});

describe("privacy-safe exports", () => {
  const safe = privacySafeRecords(rec);
  const safeReport = buildIntelReport(safe, { generatedAt: "2026-10-16T12:00:00Z" });
  it("take out the name everywhere and what the athlete typed, keep the training", () => {
    expect(scrubName("Marc Tremblay hit a PR, Marc said it moved", "Marc Tremblay")).toBe("Athlete hit a PR, Athlete said it moved");
    const all = reportToMarkdown(safeReport, safe, { privacySafe: true }) + reportToJson(safeReport, safe, { privacySafe: true }) + reportToCsv(safeReport);
    expect(all).not.toMatch(/Marc|Tremblay|hospital|a bit sore/);
    expect(safe.results).toHaveLength(rec.results.length);
    expect(safeReport.coverage.workingSets).toBe(report.coverage.workingSets);
    expect(exportFileName(safeReport, "pdf", true)).toBe("program-intelligence-athlete-2026-10-16.pdf");
    expect(exportFileName(report, "md", false)).toBe("program-intelligence-marc-tremblay-2026-10-16.md");
  });
});
