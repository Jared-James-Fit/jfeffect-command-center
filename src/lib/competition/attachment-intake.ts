import { z } from "zod";

const clock = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, "Use 24-hour HH:MM");
const text = (max: number) => z.string().trim().min(1).max(max).optional();
export const meetLogisticsFields = z.object({
  session_label: text(40), flight: text(40), weigh_in_at: clock.optional(),
  lifting_start: clock.optional(), location: text(160), division: text(80),
  equipment_event: text(100), weight_class: text(20).transform((v) => v?.replace(/\s*kg$/i, "")),
}).strict().refine((v) => Object.values(v).some((x) => x !== undefined), "At least one field is required");

export const meetIntakeParams = z.object({
  client_id: z.string().uuid(),
  competition_id: z.string().uuid(),
  fields: meetLogisticsFields,
  attachment_number: z.number().int().min(1).max(5).describe("Number of the source attachment in the latest attached message"),
  confidence: z.enum(["high", "medium", "low"]),
  evidence: z.string().trim().min(1).max(2000).describe("Exact relevant text read from the source; omit uncertain fields"),
});

export const MEET_LOGISTICS_LABELS: Record<string, string> = {
  session_label: "Session", flight: "Flight", weigh_in_at: "Weigh-ins", lifting_start: "Lifting starts",
  location: "Venue", division: "Division", equipment_event: "Equipment / event", weight_class: "Weight class",
};
export function logisticsBefore(row: Record<string, unknown>, patch: Record<string, unknown>) {
  return Object.fromEntries(Object.keys(patch).filter((k) => patch[k] !== undefined).map((k) => [k, row[k] ?? null]));
}
export function logisticsChanges(before: Record<string, unknown>, patch: Record<string, unknown>) {
  return Object.entries(patch).filter(([, v]) => v !== undefined).map(([k, v]) => {
    const old = before[k];
    const conflict = old != null && old !== v;
    return `${MEET_LOGISTICS_LABELS[k] ?? k}: ${conflict ? `${String(old)} → ` : ""}${String(v)}${conflict ? " (replaces existing value)" : ""}`;
  });
}
