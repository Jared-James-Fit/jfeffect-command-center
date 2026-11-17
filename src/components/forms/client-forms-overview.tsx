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
import { FormAnswersList } from "@/components/forms/form-responses";

const db = supabase as any;

type Item = {
  formId: string;
  title: string;
  allowUpdates: boolean;
  askedAt: string | null;
  dueAt: string | null;
  sub: { id: string; status: string; submitted_at: string | null; answers_updated_at: string | null; created_at: string } | null;
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
        db.from("nf_assignments").select("form_id, created_at, updated_at, next_due_at, form:form_id(title, allow_updates, archived)").eq("client_id", clientId),
        db
          .from("nf_submissions")
          .select("id, form_id, status, submitted_at, answers_updated_at, created_at, form:form_id(title, allow_updates, archived)")
          .eq("client_id", clientId)
          .order("created_at", { ascending: false })
          .limit(200),
      ]);
      const by = new Map<string, Item>();
      for (const s of (subs ?? []) as any[]) {
        const it = by.get(s.form_id);
        if (it) {
          it.older++;
          continue;
        }
        by.set(s.form_id, { formId: s.form_id, title: s.form?.title ?? "Form", allowUpdates: !!s.form?.allow_updates, askedAt: null, dueAt: null, sub: s, older: 0 });
      }
      for (const a of (asg ?? []) as any[]) {
        if (a.form?.archived) continue;
        const it = by.get(a.form_id) ?? { formId: a.form_id, title: a.form?.title ?? "Form", allowUpdates: !!a.form?.allow_updates, askedAt: null, dueAt: null, sub: null, older: 0 };
        it.askedAt = a.updated_at ?? a.created_at;
        it.dueAt = a.next_due_at ?? null;
        by.set(a.form_id, it);
      }
      return [...by.values()].sort((a, b) => String(b.sub?.answers_updated_at ?? b.sub?.submitted_at ?? b.askedAt ?? "").localeCompare(String(a.sub?.answers_updated_at ?? a.sub?.submitted_at ?? a.askedAt ?? "")));
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

/** Out with them: sent and nothing back since it was asked for (or a draft they started). */
function isWaiting(i: Item): boolean {
  if (!i.sub) return true;
  if (i.sub.status === "in_progress") return true;
  if (i.allowUpdates) return false;
  return !!i.askedAt && (i.sub.submitted_at ?? i.sub.created_at) < new Date(Date.parse(i.askedAt) - 60_000).toISOString();
}

function OverviewRow({ item, clientId }: { item: Item; clientId: string }) {
  const [open, setOpen] = useState(false);
  const waiting = isWaiting(item);
  const overdue = waiting && !!item.dueAt && item.dueAt < new Date().toISOString();
  const { data: ready } = useFormReadiness(item.sub?.id, item.formId, { enabled: item.allowUpdates && !!item.sub });
  const line = ready
    ? readinessLine(ready.readiness)
    : !item.sub || (waiting && item.sub.status !== "in_progress")
      ? overdue
        ? "Overdue"
        : `Sent ${relativeTime(item.askedAt) ?? ""}`.trim()
      : item.sub.status === "in_progress"
        ? "Filling it in"
        : `Answered ${new Date(item.sub.submitted_at ?? item.sub.created_at).toLocaleDateString("en-CA", { month: "short", day: "numeric" })}`;
  const canOpen = !!item.sub && item.sub.status !== "in_progress";
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
      {open && item.sub && (
        <div className="px-3 pb-3">
          {ready ? (
            <div className="space-y-2">
              <ReadinessSummary data={ready} />
              <ChecklistAnswers data={ready} />
            </div>
          ) : (
            <FormAnswersList submissionId={item.sub.id} formId={item.formId} />
          )}
        </div>
      )}
    </li>
  );
}
