import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Trophy } from "lucide-react";
import { Card } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { readinessLine, type Readiness } from "@/lib/form-checklist";
import { daysOutLabel, daysUntil, weightCheck, MEET_CHECKLIST_FORM_TYPE, type MeetFacts } from "@/lib/meet-checklist";
import { computeFormReadiness, relativeTime, todayLocal, verdictTone } from "@/components/forms/readiness-view";

const db = supabase as any;

export type MeetBoardRow = {
  clientId: string;
  name: string;
  meetName: string | null;
  meetDate: string | null;
  days: number | null;
  readiness: Readiness | null;
  facts: MeetFacts | null;
  updatedAt: string | null;
  sentAt: string | null;
};

/**
 * Every athlete with a meet checklist out, soonest meet first: where they
 * stand, the critical items still open, a weight concern, the handler, and
 * when they last changed it. Read live from their answers each time. Hidden
 * when nobody has a meet coming up.
 */
export function useMeetBoard() {
  return useQuery({
    queryKey: ["meet-readiness-board"],
    staleTime: 60_000,
    queryFn: async (): Promise<MeetBoardRow[]> => {
      const today = todayLocal();
      const { data: forms } = await db.from("nf_forms").select("id, form_type, settings").eq("form_type", MEET_CHECKLIST_FORM_TYPE).eq("archived", false);
      const formIds = ((forms ?? []) as any[]).map((f) => f.id);
      if (!formIds.length) return [];
      const since = new Date(Date.now() - 120 * 86_400_000).toISOString();
      const [{ data: subs }, { data: asg }, { data: qs }] = await Promise.all([
        db
          .from("nf_submissions")
          .select("id, form_id, client_id, status, submitted_at, answers_updated_at, created_at, client:client_id(full_name, archived)")
          .in("form_id", formIds)
          .gte("created_at", since)
          .order("created_at", { ascending: false })
          .limit(300),
        db
          .from("nf_assignments")
          .select("form_id, client_id, settings, last_sent_at, updated_at, client:client_id(full_name, archived)")
          .in("form_id", formIds)
          .gte("updated_at", since),
        db.from("nf_questions").select("id, form_id, label, question_type, required, options, validation, conditional_logic, order_index").in("form_id", formIds).is("archived_at", null),
      ]);
      const latest = new Map<string, any>();
      for (const s of (subs ?? []) as any[]) if (!latest.has(s.client_id) && !s.client?.archived) latest.set(s.client_id, s);
      const subIds = [...latest.values()].map((s) => s.id);
      const { data: answers } = subIds.length
        ? await db.from("nf_answers").select("submission_id, question_id, value_text, value_number, value_json").in("submission_id", subIds)
        : { data: [] };
      const answersBy = new Map<string, any[]>();
      for (const a of (answers ?? []) as any[]) answersBy.set(a.submission_id, [...(answersBy.get(a.submission_id) ?? []), a]);
      const formBy = new Map(((forms ?? []) as any[]).map((f) => [f.id, f]));
      const qsBy = new Map<string, any[]>();
      for (const q of (qs ?? []) as any[]) qsBy.set(q.form_id, [...(qsBy.get(q.form_id) ?? []), q]);

      const rows: MeetBoardRow[] = [];
      for (const s of latest.values()) {
        const r = computeFormReadiness(formBy.get(s.form_id) ?? {}, (qsBy.get(s.form_id) ?? []).sort((a, b) => a.order_index - b.order_index), answersBy.get(s.id) ?? [], today);
        const meetDate = r.facts?.meetDate ?? null;
        rows.push({
          clientId: s.client_id,
          name: s.client?.full_name ?? "Athlete",
          meetName: r.facts?.meetName ?? null,
          meetDate,
          days: daysUntil(meetDate, today),
          readiness: r.readiness,
          facts: r.facts,
          updatedAt: s.answers_updated_at ?? s.submitted_at ?? s.created_at,
          sentAt: null,
        });
      }
      // Sent and not opened yet.
      for (const a of (asg ?? []) as any[]) {
        if (latest.has(a.client_id) || a.client?.archived) continue;
        const meet = (a.settings as any)?.meet ?? null;
        rows.push({
          clientId: a.client_id,
          name: a.client?.full_name ?? "Athlete",
          meetName: meet?.name ?? null,
          meetDate: meet?.date ?? null,
          days: daysUntil(meet?.date ?? null, today),
          readiness: null,
          facts: null,
          updatedAt: null,
          sentAt: a.last_sent_at ?? a.updated_at,
        });
      }
      // Meets still ahead (or yesterday's), and undated ones touched in the last 3 weeks.
      const recent = (iso: string | null) => !!iso && Date.now() - Date.parse(iso) < 21 * 86_400_000;
      return rows
        .filter((r) => (r.days != null ? r.days >= -1 : recent(r.updatedAt ?? r.sentAt)))
        .sort((a, b) => (a.days ?? 999) - (b.days ?? 999) || a.name.localeCompare(b.name));
    },
  });
}

export function MeetReadinessCard() {
  const { data: rows = [] } = useMeetBoard();
  if (!rows.length) return null;
  const attention = rows.filter((r) => !r.readiness || r.readiness.verdict !== "ready").length;
  return (
    <Card className="p-4" data-meet-readiness>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-[16px] font-semibold">
          <Trophy className="h-4 w-4 text-muted-foreground" /> Meet day readiness
        </h2>
        <span className="text-[13px] text-muted-foreground">{attention ? `${attention} not ready` : "All ready"}</span>
      </div>
      <ul className="divide-y divide-border">
        {rows.map((r) => {
          const critical = (r.readiness?.issues ?? []).filter((i) => i.kind !== "unconfirmed" && i.severity === "critical");
          const weight = r.facts ? weightCheck(r.facts, r.days) : null;
          const concern = r.facts?.weightConcern && r.facts.weightConcern !== "No concerns" ? r.facts.weightConcern : null;
          const handlerOpen = r.readiness?.areas.find((a) => a.key === "handler" && a.status === "attention");
          return (
            <li key={r.clientId}>
              <Link to="/admin/messages" search={{ client: r.clientId } as any} className="block py-2.5" data-meet-row>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="truncate text-[15px] font-semibold">{r.name}</span>
                  <span className={cn("shrink-0 text-[13px] tabular-nums", r.days != null && r.days <= 7 ? "font-semibold text-foreground" : "text-muted-foreground")}>
                    {daysOutLabel(r.days) ?? "Date not set"}
                  </span>
                </div>
                <p className="truncate text-[13px] text-muted-foreground">
                  {[r.meetName, r.meetDate ? new Date(`${r.meetDate}T00:00:00`).toLocaleDateString("en-CA", { month: "short", day: "numeric" }) : null].filter(Boolean).join(" · ") || "Meet not named yet"}
                </p>
                <p className={cn("text-[13px] font-medium", r.readiness ? verdictTone(r.readiness) : "text-muted-foreground")}>
                  {r.readiness ? readinessLine(r.readiness) : `Not opened yet · sent ${relativeTime(r.sentAt) ?? ""}`}
                  {r.updatedAt && r.readiness ? <span className="font-normal text-muted-foreground"> · updated {relativeTime(r.updatedAt)}</span> : null}
                </p>
                {critical.length > 0 && <p className="text-[13px] text-destructive">Still need: {critical.map((i) => i.label).join(", ")}</p>}
                {(weight || concern) && <p className="text-[13px] text-warning">Weight: {weight ? weight.line : concern}</p>}
                {handlerOpen && <p className="text-[13px] text-warning">Handler: {r.facts?.handler ?? "not confirmed"}</p>}
              </Link>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
