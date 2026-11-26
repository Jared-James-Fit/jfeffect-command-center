/** Meet-specific source proposals. No extracted value becomes a confirmed meet fact without review. */
import { MEET_LOGISTICS_LABELS } from "@/lib/competition/attachment-intake";

export type MeetFileField = { field: string; value: string; text: string };
export type MeetFileProposal = { factId: string; field: string; value: string; before: string | null; source: string; quote: string | null; location: string | null; conflict: boolean };
const limits: Record<string, number> = { session_label:40, flight:40, weigh_in_at:5, lifting_start:5, location:160, division:80, equipment_event:100, weight_class:20 };
const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
const time = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
export function validMeetFileValue(field: string, input: string): boolean {
  if (!Object.prototype.hasOwnProperty.call(limits, field)) return false;
  const value = input.trim();
  if (!value || value.length > limits[field]!) return false;
  if (field === "weigh_in_at" || field === "lifting_start") return time.test(value);
  return true;
}
export function defaultMeetFileSelection(rows: MeetFileProposal[]): string[] {
  return rows.filter(p => !p.conflict && validMeetFileValue(p.field, p.value)).map(p => p.factId);
}
export function readMeetFileField(raw: any, ground: string): MeetFileField | null {
  const field = typeof raw?.field === "string" ? raw.field : "";
  if (!Object.prototype.hasOwnProperty.call(limits, field)) return null;
  const value = typeof raw.value === "string" ? raw.value.trim() : "";
  const quote = typeof raw.quote === "string" ? raw.quote.trim() : "";
  if (!value || value.length > limits[field]! || !quote || !normalize(ground).includes(normalize(quote))) return null;
  if (field === "weigh_in_at" || field === "lifting_start") {
    if (!time.test(value)) return null;
    const [h,m] = value.split(":").map(Number);
    const match = [...quote.matchAll(/\b(\d{1,2}):(\d{2})\s*(a\.?m\.?|p\.?m\.?)?/gi)].some(t => {
      const hour = Number(t[1]), minute = Number(t[2]), meridiem = t[3]?.toLowerCase().replace(/\./g,"");
      return minute === m && (meridiem ? hour >= 1 && hour <= 12 && hour % 12 + (meridiem === "pm" ? 12 : 0) === h : hour === h);
    });
    if (!match) return null;
  } else if (!(" " + normalize(quote) + " ").includes(" " + normalize(value) + " ")) return null;
  return { field, value, text: `${MEET_LOGISTICS_LABELS[field]}: ${value}` };
}
export function sameMeetValue(field: string, a: unknown, b: unknown): boolean {
  if (field === "weight_class") return String(a ?? "").replace(/\s*kg$/i,"").trim() === String(b ?? "").replace(/\s*kg$/i,"").trim();
  return String(a ?? "").trim().toLowerCase() === String(b ?? "").trim().toLowerCase();
}
export function meetFileProposals(facts: any[], sources: any[], comp: any): MeetFileProposal[] {
  if (!comp?.id) return [];
  const ready = new Map(sources.filter(s => s.status === "ready" && s.competition_id === comp.id).map(s => [s.id,s]));
  const candidates: MeetFileProposal[] = facts.flatMap(f => {
    const d = f.data?.meetLogistics;
    const src = ready.get(f.source_id);
    if (f.status !== "active" || f.competition_id !== comp.id || !src || !d || typeof d.value !== "string" || !validMeetFileValue(d.field,d.value)) return [];
    return [{ factId: f.id as string, field: d.field as string, value: d.value as string, before: (comp[d.field] ?? null) as string | null, source: String(src.file_name ?? "Typed note"), quote: f.quote as string | null, location: f.location as string | null, conflict: false }];
  });
  // Include matching/current evidence when detecting disagreement; it must not
  // turn an unresolved contradictory proposal into a default-selected update.
  const unique = candidates.filter((p, i) => candidates.findIndex(other => other.field === p.field && sameMeetValue(p.field, other.value, p.value)) === i);
  return unique.filter(p => !sameMeetValue(p.field,p.before,p.value)).map(p => ({
    ...p,
    conflict: unique.some(other => other.field === p.field && !sameMeetValue(p.field,other.value,p.value)),
  })).slice(0,30);
}
