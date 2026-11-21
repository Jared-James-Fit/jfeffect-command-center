/**
 * Reading a program file on the phone, with no AI and nothing sent anywhere:
 * CSV, Excel (.xlsx) and Word (.docx) become sheets of cell text exactly as
 * the person sees them (a cell formatted as a percentage reads "75%", not
 * 0.75), and plain text. PDFs and photos aren't read here: the server's AI
 * reads those (import.server.ts). Pure: bytes in, text out.
 */
import { strFromU8, unzipSync } from "fflate";
import type { SourceDoc, SourceSheet } from "./types";

/** The most rows / cells / characters a file is read to (a program is far smaller). */
export const MAX_ROWS = 2000;
export const MAX_COLS = 60;
export const MAX_TEXT = 120_000;

export class UnreadableFile extends Error {}

/* ------------------------------------------------------------------ */
/*  Text helpers                                                       */
/* ------------------------------------------------------------------ */

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
export function decodeXml(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

const clean = (s: string) => s.replace(/ /g, " ").replace(/[ \t]+/g, " ").trim();

/** Sheets as text: one line per row, cells joined with " | ", empty rows dropped. */
export function sheetsToText(sheets: SourceSheet[]): string {
  const parts: string[] = [];
  for (const sh of sheets) {
    const rows = sh.rows
      .map((r) => {
        let end = r.length;
        while (end > 0 && !r[end - 1]) end--;
        return r.slice(0, end);
      })
      .filter((r) => r.some((c) => c.trim()));
    if (!rows.length) continue;
    if (sheets.length > 1 || sh.name) parts.push(`=== ${sh.name || "Sheet"} ===`);
    for (const r of rows) parts.push(r.map((c) => c.replace(/\s*\n\s*/g, " / ")).join(" | "));
  }
  return parts.join("\n").slice(0, MAX_TEXT);
}

/* ------------------------------------------------------------------ */
/*  CSV                                                                */
/* ------------------------------------------------------------------ */

/** The separator a CSV uses: comma, semicolon (European Excel) or tab, by the first lines. */
function csvDelimiter(text: string): string {
  const head = text.split(/\r?\n/).slice(0, 10).join("\n");
  const count = (ch: string) => {
    let n = 0;
    let q = false;
    for (const c of head) {
      if (c === '"') q = !q;
      else if (!q && c === ch) n++;
    }
    return n;
  };
  const tab = count("\t");
  const semi = count(";");
  const comma = count(",");
  if (tab > comma && tab >= semi) return "\t";
  if (semi > comma) return ";";
  return ",";
}

/** RFC 4180 CSV: quoted cells, doubled quotes, line breaks inside quotes. */
export function parseCsv(text: string, name = "Sheet 1"): SourceSheet {
  const src = text.replace(/^﻿/, "");
  const d = csvDelimiter(src);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let q = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (q) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else q = false;
      } else cell += c;
      continue;
    }
    if (c === '"' && !cell.trim()) {
      q = true;
      cell = "";
    } else if (c === d) {
      row.push(clean(cell));
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(clean(cell));
      rows.push(row.slice(0, MAX_COLS));
      row = [];
      cell = "";
      if (rows.length >= MAX_ROWS) break;
    } else cell += c;
  }
  if (cell || row.length) {
    row.push(clean(cell));
    rows.push(row.slice(0, MAX_COLS));
  }
  return { name, rows };
}

/* ------------------------------------------------------------------ */
/*  XLSX                                                               */
/* ------------------------------------------------------------------ */

function unzip(bytes: Uint8Array, keep: (name: string) => boolean): Record<string, string> {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, { filter: (f) => keep(f.name) });
  } catch {
    throw new UnreadableFile("This file couldn't be opened. Save it again and try once more.");
  }
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(files)) out[k] = strFromU8(v);
  return out;
}

const attr = (tag: string, name: string) => {
  const m = new RegExp(`\\b${name}="([^"]*)"`).exec(tag);
  return m ? decodeXml(m[1]) : null;
};

/** "B12" → column index 1 (0-based). */
export function columnIndex(ref: string): number {
  const letters = /^[A-Z]+/i.exec(ref)?.[0].toUpperCase() ?? "A";
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}
const rowIndex = (ref: string) => Math.max(0, Number(/\d+$/.exec(ref)?.[0] ?? 1) - 1);

/** All the text runs in a shared or inline string (`<t>`), joined. */
function runsText(xml: string): string {
  let out = "";
  const re = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t(?:\s[^>]*)?\/>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) out += decodeXml(m[1] ?? "");
  return out;
}

/** A number as a person reads it: 8, 7.5, 0.333 (never 0.30000000000000004). */
export function numberText(v: number): string {
  if (!Number.isFinite(v)) return "";
  const r = Math.round(v * 10000) / 10000;
  return String(r);
}

/** Which cell styles show a number as a percentage (built-in formats 9, 10, or a custom one with %). */
function percentStyles(stylesXml: string | undefined): Set<number> {
  const out = new Set<number>();
  if (!stylesXml) return out;
  const custom = new Map<number, string>();
  for (const m of stylesXml.matchAll(/<numFmt\b[^>]*\/?>/g)) {
    const id = Number(attr(m[0], "numFmtId"));
    const code = attr(m[0], "formatCode") ?? "";
    if (Number.isFinite(id)) custom.set(id, code);
  }
  const xfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(stylesXml)?.[1] ?? "";
  let i = 0;
  for (const m of xfs.matchAll(/<xf\b[^>]*\/?>/g)) {
    const id = Number(attr(m[0], "numFmtId") ?? 0);
    const code = custom.get(id) ?? "";
    if (id === 9 || id === 10 || /%/.test(code.replace(/"[^"]*"/g, ""))) out.add(i);
    i++;
  }
  return out;
}

/** An .xlsx workbook's sheets, in tab order, each cell as shown (merged cells filled in). */
export function parseXlsx(bytes: Uint8Array): SourceSheet[] {
  const files = unzip(bytes, (n) => n.startsWith("xl/") && (n.endsWith(".xml") || n.endsWith(".rels")));
  const wb = files["xl/workbook.xml"];
  if (!wb) throw new UnreadableFile("That doesn't look like an Excel workbook (.xlsx).");
  const rels = files["xl/_rels/workbook.xml.rels"] ?? "";
  const target = new Map<string, string>();
  for (const m of rels.matchAll(/<Relationship\b[^>]*\/?>/g)) {
    const id = attr(m[0], "Id");
    const t = attr(m[0], "Target");
    if (id && t) target.set(id, t.replace(/^\/?xl\//, "").replace(/^\//, ""));
  }
  const shared: string[] = [];
  const sst = files["xl/sharedStrings.xml"];
  if (sst) for (const m of sst.matchAll(/<si>([\s\S]*?)<\/si>/g)) shared.push(runsText(m[1]));
  const pct = percentStyles(files["xl/styles.xml"]);

  const sheets: SourceSheet[] = [];
  for (const m of wb.matchAll(/<sheet\b[^>]*\/?>/g)) {
    const name = attr(m[0], "name") ?? `Sheet ${sheets.length + 1}`;
    if (attr(m[0], "state") === "hidden" || attr(m[0], "state") === "veryHidden") continue;
    const rid = attr(m[0], "r:id");
    const path = rid ? target.get(rid) : null;
    const xml = path ? files[`xl/${path}`] : undefined;
    if (!xml) continue;
    const grid: string[][] = [];
    const put = (r: number, c: number, v: string) => {
      if (r >= MAX_ROWS || c >= MAX_COLS) return;
      while (grid.length <= r) grid.push([]);
      const row = grid[r];
      while (row.length <= c) row.push("");
      row[c] = v;
    };
    for (const cm of xml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const head = cm[1];
      const body = cm[2] ?? "";
      const ref = attr(`<c ${head}>`, "r");
      if (!ref) continue;
      const t = attr(`<c ${head}>`, "t");
      const s = Number(attr(`<c ${head}>`, "s") ?? -1);
      const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let text = "";
      if (t === "s") text = shared[Number(v)] ?? "";
      else if (t === "inlineStr") text = runsText(body);
      else if (t === "str" || t === "e") text = v != null ? decodeXml(v) : "";
      else if (t === "b") text = v === "1" ? "TRUE" : v === "0" ? "FALSE" : "";
      else if (v != null && v !== "") {
        const n = Number(v);
        text = Number.isFinite(n) ? (pct.has(s) ? `${numberText(n * 100)}%` : numberText(n)) : decodeXml(v);
      }
      text = clean(text);
      if (text) put(rowIndex(ref), columnIndex(ref), text);
    }
    // a merged cell's text across every cell it covers (a week heading over three columns)
    for (const mm of xml.matchAll(/<mergeCell\b[^>]*\/?>/g)) {
      const range = attr(mm[0], "ref");
      if (!range || !range.includes(":")) continue;
      const [a, b] = range.split(":");
      const r0 = rowIndex(a);
      const r1 = rowIndex(b);
      const c0 = columnIndex(a);
      const c1 = columnIndex(b);
      const v = grid[r0]?.[c0] ?? "";
      if (!v || (r1 - r0 + 1) * (c1 - c0 + 1) > 200) continue;
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) if (!(r === r0 && c === c0)) put(r, c, v);
    }
    sheets.push({ name, rows: grid.map((r) => r.map((c) => c ?? "")) });
  }
  if (!sheets.length) throw new UnreadableFile("That workbook has no sheets with anything on them.");
  return sheets;
}

/* ------------------------------------------------------------------ */
/*  DOCX                                                               */
/* ------------------------------------------------------------------ */

/** A Word paragraph's text: its runs, tabs as spaces, breaks as new lines. */
function paragraphText(xml: string): string {
  let out = "";
  for (const m of xml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\/>|<w:br\/>|<w:cr\/>/g)) {
    if (m[1] != null) out += decodeXml(m[1]);
    else if (m[0].startsWith("<w:tab")) out += " ";
    else out += "\n";
  }
  return out.replace(/[ \t]+/g, " ").trim();
}

/** The body's top-level blocks in order: paragraphs and tables (a table nested in a table stays inside its cell). */
function bodyBlocks(body: string): Array<{ kind: "p" | "tbl"; xml: string }> {
  const out: Array<{ kind: "p" | "tbl"; xml: string }> = [];
  let i = 0;
  while (i < body.length) {
    const p = body.indexOf("<w:p", i);
    const t = body.indexOf("<w:tbl>", i);
    const tAlt = body.indexOf("<w:tbl ", i);
    const tbl = t < 0 ? tAlt : tAlt < 0 ? t : Math.min(t, tAlt);
    if (p < 0 && tbl < 0) break;
    if (tbl >= 0 && (p < 0 || tbl < p)) {
      // match the table's own end, counting tables inside it
      let depth = 0;
      let j = tbl;
      const re = /<w:tbl[\s>]|<\/w:tbl>/g;
      re.lastIndex = tbl;
      let m: RegExpExecArray | null;
      let end = body.length;
      while ((m = re.exec(body))) {
        if (m[0].startsWith("</")) depth--;
        else depth++;
        if (depth === 0) {
          end = m.index + m[0].length;
          break;
        }
        j = re.lastIndex;
      }
      void j;
      out.push({ kind: "tbl", xml: body.slice(tbl, end) });
      i = end;
    } else {
      // <w:p> or <w:pPr>… only a paragraph start counts
      const ch = body[p + 4];
      if (ch !== ">" && ch !== " ") {
        i = p + 4;
        continue;
      }
      const end = body.indexOf("</w:p>", p);
      if (end < 0) break;
      out.push({ kind: "p", xml: body.slice(p, end + 6) });
      i = end + 6;
    }
  }
  return out;
}

function tableRows(xml: string): string[][] {
  const rows: string[][] = [];
  for (const rm of xml.matchAll(/<w:tr[\s>][\s\S]*?<\/w:tr>/g)) {
    const cells: string[] = [];
    for (const cm of rm[0].matchAll(/<w:tc[\s>][\s\S]*?<\/w:tc>/g)) {
      const paras = [...cm[0].matchAll(/<w:p[\s>][\s\S]*?<\/w:p>/g)].map((p) => paragraphText(p[0])).filter(Boolean);
      cells.push(clean(paras.join(" / ")));
    }
    rows.push(cells.slice(0, MAX_COLS));
    if (rows.length >= MAX_ROWS) break;
  }
  return rows;
}

/** A Word document as text (paragraphs, tables as " | " rows) and its tables as sheets. */
export function parseDocx(bytes: Uint8Array): { text: string; sheets: SourceSheet[] } {
  const files = unzip(bytes, (n) => n === "word/document.xml");
  const doc = files["word/document.xml"];
  if (!doc) throw new UnreadableFile("That doesn't look like a Word document (.docx).");
  const body = /<w:body>([\s\S]*)<\/w:body>/.exec(doc)?.[1] ?? doc;
  const lines: string[] = [];
  const sheets: SourceSheet[] = [];
  // the paragraphs since the last table: they name the next one ("Week 2" then "Day 1: Lower"),
  // so a table's name keeps every heading above it, one per line, never just the nearest
  let since: string[] = [];
  for (const b of bodyBlocks(body)) {
    if (b.kind === "p") {
      const t = paragraphText(b.xml);
      if (t) {
        lines.push(t);
        since.push(t);
      }
    } else {
      const rows = tableRows(b.xml);
      sheets.push({ name: since.slice(-4).join("\n").slice(0, 400), rows });
      since = [];
      for (const r of rows) if (r.some(Boolean)) lines.push(r.join(" | "));
    }
  }
  // what's written after the last table (more days, or notes) is read as lines
  if (sheets.length && since.length) sheets.push({ name: "", rows: since.map((t) => [t]) });
  return { text: lines.join("\n").slice(0, MAX_TEXT), sheets };
}

/* ------------------------------------------------------------------ */
/*  One entry point                                                    */
/* ------------------------------------------------------------------ */

/** What a file is, by its name and type: what the phone can read, what the server's AI reads. */
export function fileKind(name: string, type: string): SourceDoc["kind"] | "xls" | "unsupported" {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  const t = type.toLowerCase();
  if (ext === "csv" || t === "text/csv") return "csv";
  if (ext === "tsv") return "csv";
  if (ext === "xlsx" || ext === "xlsm" || t.includes("spreadsheetml")) return "xlsx";
  if (ext === "xls" || t === "application/vnd.ms-excel") return "xls";
  if (ext === "docx" || t.includes("wordprocessingml")) return "docx";
  if (ext === "pdf" || t === "application/pdf") return "pdf";
  if (/^(jpe?g|png|webp|heic|heif)$/.test(ext) || t.startsWith("image/")) return "image";
  if (ext === "txt" || ext === "md" || t.startsWith("text/")) return "text";
  return "unsupported";
}

/** A file the phone can read, read. PDFs and photos aren't (the server's AI reads those). */
export function readLocalFile(name: string, kind: "csv" | "xlsx" | "docx" | "text", bytes: Uint8Array): SourceDoc {
  if (kind === "xlsx") {
    const sheets = parseXlsx(bytes);
    return { kind, name, sheets, text: sheetsToText(sheets) };
  }
  if (kind === "docx") {
    const { text, sheets } = parseDocx(bytes);
    if (!text.trim()) throw new UnreadableFile("That document is empty, or its text is in pictures. Try a PDF or a photo of it.");
    return { kind, name, sheets, text };
  }
  const raw = new TextDecoder("utf-8").decode(bytes);
  if (kind === "csv") {
    const sheet = parseCsv(raw, name.replace(/\.[^.]+$/, ""));
    return { kind, name, sheets: [sheet], text: sheetsToText([sheet]) };
  }
  return { kind, name, text: raw.replace(/\r\n?/g, "\n").slice(0, MAX_TEXT) };
}
