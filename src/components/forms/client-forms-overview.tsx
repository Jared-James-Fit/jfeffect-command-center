import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Send } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { sendMessage } from "@/lib/messages";
import { readinessLine } from "@/lib/form-checklist";
import { FormPickerSheet } from "@/components/forms/form-picker-sheet";
import { ChecklistAnswers, ReadinessSummary, relativeTime, useFormReadiness, verdictTone } from "@/components/forms/readiness-view";
import { FormAnswersList, FormResponsesSheet } from "@/components/forms/form-responses";
import { formPeople, type PersonState } from "@/lib/form-response-status";

const db = supabase as any;

type Sub = { id: string; status: string; submitted_at: string | null; answers_updated_at: string | null; created_at: string; updated_at?: string | null };

type Item = {
  formId: string;
  title: string;
  allowUpdates: boolean;
  askedAt: string | null;
  dueAt: string | null;
  /** Their latest sent response: what opens. */
  sub: Sub | null;
  /** The draft they're on, when they've touched it since it was asked for. */
  draft: Sub | null;
  /** Where it stands, on the library's and the responses viewer's rule (personState). */
  state: PersonState;
  older: number;
};

/**
 * A client's forms on their profile: what's out with them (waiting, being
 * filled in, overdue), what came back (latest first, answers a tap away) and
 * Send a form. The same assignments and submissions the chat card and the
 * library read, never a copy.
 */
export function ClientFormsOverview({ clientId, firstName }: { clientId: string; firstName?: string | null }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [picking, setPicking] = useState(false);
  const { data: items = [], isLoading } = useQuery({
    queryKey: ["client-forms-overview", clientId],
    staleTime: 30_000,
    queryFn: async (): Promise<Item[]> => {
      const [{ data: asg }, { data: subs }] = await Promise.all([
        db.from("nf_assignments").select("form_id, client_id, created_at, updated_at, next_due_at, settings, form:form_id(title, allow_updates, archived)").eq("client_id", clientId),
        db
          .from("nf_submissions")
          .select("id, form_id, client_id, status, submitted_at, answers_updated_at, created_at, updated_at, form:form_id(title, allow_updates, archived)")
          .eq("client_id", clientId)
          .order("created_at", { ascending: false })
          .limit(200),
      ]);
      // One form at a time, on the same rule as the library and the responses viewer.
      type FormEntry = { title: string; allowUpdates: boolean; archived: boolean; asg: any | null; subs: any[] };
      const forms = new Map<string, FormEntry>();
      const entry = (formId: string, f: any): FormEntry => {
        const e: FormEntry = forms.get(formId) ?? { title: f?.title ?? "Form", allowUpdates: !!f?.allow_updates, archived: !!f?.archived, asg: null, subs: [] };
        forms.set(formId, e);
        return e;
      };
      // a draft is touched when an answer on it changes (saving one never moves the submission's row)
      const draftIds = ((subs ?? []) as any[]).filter((x) => x.status === "in_progress").map((x) => x.id);
      if (draftIds.length) {
        const { data: touched } = await db.from("nf_answers").select("submission_id, created_at, updated_at").in("submission_id", draftIds.slice(0, 150));
        const last = new Map<string, string>();
        for (const r of (touched ?? []) as any[]) {
          const at = [r.updated_at, r.created_at].filter(Boolean).sort().pop();
          if (at && (!last.has(r.submission_id) || at > last.get(r.submission_id)!)) last.set(r.submission_id, at);
        }
        for (const x of (subs ?? []) as any[]) if (last.has(x.id)) x.answers_touched_at = last.get(x.id);
      }
      for (const s of (subs ?? []) as any[]) entry(s.form_id, s.form).subs.push(s);
      // an archived form isn't out with anyone: only what they sent stays
      for (const a of (asg ?? []) as any[]) if (!a.form?.archived) entry(a.form_id, a.form).asg = a;
      const out: Item[] = [];
      for (const [formId, f] of forms) {
        const person = formPeople(f.asg ? [f.asg] : [], f.subs, { keepsUpdating: f.allowUpdates })[0];
        if (!person) continue;
        const sentSub = person.responses[0] ? f.subs.find((s) => s.id === person.responses[0].id) ?? null : null;
        const draft = person.draft ? f.subs.find((s) => s.id === person.draft!.id) ?? null : null;
        out.push({
          formId,
          title: f.title,
          allowUpdates: f.allowUpdates,
          askedAt: person.askedAt,
          dueAt: f.asg?.next_due_at ?? null,
          sub: sentSub,
          draft,
          state: person.state,
          older: Math.max(0, person.responses.length - 1),
        });
      }
      const when = (i: Item) => String(i.sub?.answers_updated_at ?? i.sub?.submitted_at ?? i.draft?.created_at ?? i.askedAt ?? "");
      return out.sort((a, b) => when(b).localeCompare(when(a)));
    },
  });

  const waiting = items.filter((i) => isWaiting(i));
  const answered = items.filter((i) => !isWaiting(i));

  return (
    <div className="space-y-3" data-client-forms>
      <div className="flex items-center justify-between gap-3">
        <p className="text-[13px] text-muted-foreground">
          {isLoading ? "Loading…" : `${waiting.length} out with them · ${answered.length} answered`}
        </p>
        <Button size="sm" onClick={() => setPicking(true)} data-client-forms-send>
          <Send className="mr-1.5 h-4 w-4" /> Send a form
        </Button>
      </div>
      {waiting.length > 0 && (
        <ul className="divide-y divide-border rounded-xl border border-border">
          {waiting.map((i) => <OverviewRow key={i.formId} item={i} clientId={clientId} />)}
        </ul>
      )}
      {answered.length > 0 && (
        <ul className="divide-y divide-border rounded-xl border border-border">
          {answered.map((i) => <OverviewRow key={i.formId} item={i} clientId={clientId} />)}
        </ul>
      )}
      <FormPickerSheet
        open={picking}
        onOpenChange={setPicking}
        clientIds={[clientId]}
        clientName={firstName ?? null}
        onAttach={async (att, body) => {
          if (!user) return;
          // The card goes to their chat like any send, so they open it where they always do.
          await sendMessage({ clientId, senderId: user.id, senderRole: "admin", body, attachments: [att as any], messageType: "Form" });
          await qc.invalidateQueries({ queryKey: ["client-forms-overview", clientId] });
          await qc.invalidateQueries({ queryKey: ["messages", clientId] });
        }}
      />
    </div>
  );
}

/** Out with them: asked for and nothing back since (or a draft they started), personState's reading. */
function isWaiting(i: Item): boolean {
  return i.state !== "answered";
}

function OverviewRow({ item, clientId }: { item: Item; clientId: string }) {
  const [open, setOpen] = useState(false);
  const [viewing, setViewing] = useState(false);
  const overdue = item.state === "waiting" && !!item.dueAt && item.dueAt < new Date().toISOString();
  // a checklist they keep updating reads off the copy they're on, sent or not
  const latest = item.allowUpdates ? item.sub ?? item.draft : item.sub;
  const { data: ready } = useFormReadiness(latest?.id, item.formId, { enabled: item.allowUpdates && !!latest });
  // the line follows where it stands (personState), never just the newest row
  const line = ready
    ? readinessLine(ready.readiness)
    : item.state === "in_progress"
      ? "Filling it in"
      : item.state === "waiting"
        ? overdue
          ? "Overdue"
          : `${item.sub ? "Asked again" : "Sent"} ${relativeTime(item.askedAt) ?? ""}`.trim()
        : `Answered ${new Date(item.sub!.submitted_at ?? item.sub!.created_at).toLocaleDateString("en-CA", { month: "short", day: "numeric" })}`;
  const canOpen = !!item.sub;
  return (
    <li>
      <button type="button" disabled={!canOpen && !ready} onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex min-h-[52px] w-full items-center gap-3 px-3 py-2 text-left disabled:opacity-100">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-semibold">{item.title}</p>
          <p className={cn("truncate text-[13px]", overdue ? "text-destructive" : ready ? verdictTone(ready.readiness) : "text-muted-foreground")}>
            {line}
            {item.sub?.answers_updated_at ? ` · updated ${relativeTime(item.sub.answers_updated_at)}` : ""}
            {item.older ? ` · ${item.older} earlier` : ""}
          </p>
        </div>
        {(canOpen || ready) && <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />}
      </button>
      {open && (item.sub || ready) && (
        <div className="space-y-3 px-3 pb-3">
          {ready ? (
            <div className="space-y-2">
              <ReadinessSummary data={ready} />
              <ChecklistAnswers data={ready} />
            </div>
          ) : item.sub ? (
            <FormAnswersList submissionId={item.sub.id} formId={item.formId} />
          ) : null}
          {item.sub && (
            <Button type="button" variant="outline" size="sm" className="h-10 w-full" onClick={() => setViewing(true)} data-client-form-responses>
              Open in responses{item.older ? ` · ${item.older + 1} from them` : ""}
            </Button>
          )}
        </div>
      )}
      {viewing && item.sub && (
        <FormResponsesSheet formId={item.formId} title={item.title} submissionId={item.sub.id} clientId={clientId} open onOpenChange={(o) => !o && setViewing(false)} />
      )}
    </li>
  );
}
