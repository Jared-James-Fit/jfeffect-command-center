/**
 * Client profile → Nutrition → Food & diet: what to keep in mind before
 * touching their nutrition, in one place. Allergies first (amber when there
 * are any), the diets they follow as tags, what they eat and won't, health
 * things, their goal, then how they eat day to day, and the coach's own
 * nutrition notes, which the nutrition AI follows. Read from their latest
 * Nutrition Update and Goals & Setup (`foodNotes`, food-notes.ts); the notes
 * are `client_file_notes` with topic 'nutrition', so they're in the client's
 * one notes list too.
 */
import { useMemo, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { AlertTriangle, Plus, Salad } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Accordion } from "@/components/ui/accordion";
import { CardHeader, Section } from "@/components/nutrition/nutrition-ui";
import { NoteRow } from "@/components/clients/client-file-notes";
import { listNutritionRequestsFn } from "@/lib/nutrition-ai-plans.functions";
import {
  addClientFileNote,
  clientFileNotesKey,
  listClientFileNotes,
  setClientFileNoteArchived,
  sortActive,
  updateClientFileNote,
  type ClientFileNote,
} from "@/lib/client-file-notes";
import { foodNotes, type FoodGoals } from "@/lib/nutrition-targets/food-notes";
import { cn } from "@/lib/utils";

type Answered = { status: string; submitted_at: string | null; answers: Array<{ label: string; value: string }> };

const shortDate = (d?: string | null) =>
  d ? new Date(d).toLocaleDateString([], { month: "short", day: "numeric" }) : null;

export function FoodNotesCard({ clientId, className }: { clientId: string; className?: string }) {
  const qc = useQueryClient();
  const listFn = useServerFn(listNutritionRequestsFn);
  // The same query as the Nutrition update card (one request for both).
  const { data: requests, isLoading: loadingRequests } = useQuery({
    queryKey: ["nutrition-requests", clientId],
    queryFn: () => listFn({ data: { clientId } }),
  });
  const { data: goalsRow, isLoading: loadingGoals } = useQuery({
    queryKey: ["client-goals-setup", clientId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("client_goals_setup")
        .select("*")
        .eq("client_id", clientId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const notesKey = clientFileNotesKey(clientId);
  const { data: allNotes = [] } = useQuery({
    queryKey: notesKey,
    queryFn: () => listClientFileNotes(clientId),
    staleTime: 15_000,
  });

  // The latest Nutrition Update they actually sent.
  const sent = ((requests?.requests ?? []) as Answered[]).find((r) => r.status !== "in_progress" && r.answers?.length) ?? null;
  // Another screen may hold this key with its own shape: only a row counts.
  const goals = goalsRow && typeof goalsRow === "object" && "client_id" in goalsRow ? (goalsRow as FoodGoals) : null;
  const notes = useMemo(
    () => sortActive(allNotes.filter((n) => n.topic === "nutrition" && !n.archived_at)),
    [allNotes],
  );
  const f = useMemo(
    () => foodNotes({ answers: sent?.answers ?? null, answersAt: sent?.submitted_at ?? null, goals, coachNotes: notes.map((n) => [n.title, n.body].filter((s) => s.trim()).join("\n")) }),
    [sent, goals, notes],
  );

  const [composing, setComposing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const patchLocal = (id: string, patch: Partial<ClientFileNote>) =>
    qc.setQueryData<ClientFileNote[]>(notesKey, (old) => (old ?? []).map((n) => (n.id === id ? { ...n, ...patch } : n)));
  const refresh = () => qc.invalidateQueries({ queryKey: notesKey });

  const save = async () => {
    if (!draft.trim()) return;
    setSaving(true);
    try {
      const row = await addClientFileNote(clientId, "", draft, "nutrition");
      qc.setQueryData<ClientFileNote[]>(notesKey, (old) => [row, ...(old ?? [])]);
      setDraft("");
      setComposing(false);
      toast.success("Saved. The AI follows it on their next plan.");
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't save the note");
    } finally {
      setSaving(false);
    }
  };
  const archive = async (n: ClientFileNote, on: boolean) => {
    const now = new Date().toISOString();
    patchLocal(n.id, on ? { archived_at: now, archive_reason: "manual", pinned: false } : { archived_at: null, archive_reason: null });
    try {
      await setClientFileNoteArchived(n.id, on);
      if (on) toast("Moved to the Archive", { action: { label: "Undo", onClick: () => void archive({ ...n, archived_at: now }, false) } });
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't update the note");
    } finally {
      void refresh();
    }
  };
  const pin = async (n: ClientFileNote) => {
    patchLocal(n.id, { pinned: !n.pinned });
    try {
      await updateClientFileNote(n.id, { pinned: !n.pinned });
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't update the note");
    } finally {
      void refresh();
    }
  };

  const loading = loadingRequests || loadingGoals;
  const sources = [sent?.submitted_at ? `their ${shortDate(sent.submitted_at)} Nutrition Update` : null, goals ? "Goals & Setup" : null].filter(Boolean);
  const dayToDay = [...f.routine, ...f.style];

  return (
    <Card className={cn("space-y-4 border-border bg-card p-4 md:p-6", className)} data-food-notes>
      <CardHeader icon={Salad} title="Food & diet" />

      {loading ? (
        <div className="space-y-2">
          <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
          <div className="h-24 animate-pulse rounded-xl bg-muted" />
        </div>
      ) : (
        <>
          <p className="text-[13px] text-muted-foreground">
            {sources.length ? `From ${sources.join(" and ")}.` : "Nothing on file yet. Their Nutrition Update and Goals & Setup answers show here."}
          </p>

          {f.diet.length > 0 && (
            <div className="flex flex-wrap gap-1.5" data-diet-tags>
              {f.diet.map((t) => (
                <span key={t} className="inline-flex h-7 items-center rounded-full bg-secondary px-2.5 text-[13px] font-medium text-foreground">
                  {t}
                </span>
              ))}
            </div>
          )}

          <dl className="divide-y divide-border rounded-xl border border-border">
            <Fact label="Allergies" attention={f.allergyState === "some"} data-allergies={f.allergyState}>
              {f.allergyState === "some" ? (
                <Clamp text={f.allergies.join("\n")} />
              ) : f.allergyState === "none" ? (
                <span className="text-muted-foreground">None</span>
              ) : (
                <span className="text-muted-foreground">Not asked yet</span>
              )}
            </Fact>
            {f.health.length > 0 && (
              <Fact label="Health" attention>
                <Clamp text={f.health.join("\n")} />
              </Fact>
            )}
            {f.eats && (
              <Fact label="Eats">
                <Clamp text={f.eats} />
              </Fact>
            )}
            {f.avoids.length > 0 && <Fact label="Won't eat">{f.avoids.join(", ")}</Fact>}
            {f.goal && (
              <Fact label="Goal">
                <Clamp text={f.goal} />
              </Fact>
            )}
          </dl>

          {dayToDay.length > 0 && (
            <Accordion type="multiple" className="rounded-xl border border-border">
              <Section value="day" title="Day to day" meta={mealsMeta(f.routine.find((r) => r.label === "Meals a day")?.value)}>
                <dl className="space-y-2">
                  {dayToDay.map((r) => (
                    <div key={r.label} className="grid grid-cols-[7rem_minmax(0,1fr)] gap-3 text-[14px]">
                      <dt className="text-muted-foreground">{r.label}</dt>
                      <dd className="min-w-0 break-words">{r.value}</dd>
                    </div>
                  ))}
                </dl>
              </Section>
            </Accordion>
          )}
        </>
      )}

      <div className="space-y-2" data-nutrition-notes>
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <h4 className="text-[15px] font-semibold">Your notes</h4>
            <p className="text-[13px] text-muted-foreground">Only you and your team see these. The AI follows them.</p>
          </div>
          {!composing && (
            <Button variant="outline" size="sm" className="h-10 shrink-0 gap-1" onClick={() => setComposing(true)}>
              <Plus className="h-4 w-4" /> Add
            </Button>
          )}
        </div>
        {composing && (
          <div className="space-y-2 rounded-xl border border-border p-3">
            <Textarea
              autoFocus
              rows={3}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="e.g. Hates fish. Eats out Friday nights, keep dinner flexible. Shellfish allergy."
              className="text-[15px]"
            />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" className="h-10" onClick={() => { setComposing(false); setDraft(""); }}>Cancel</Button>
              <Button className="h-10" onClick={save} disabled={saving || !draft.trim()}>Save</Button>
            </div>
          </div>
        )}
        {notes.length > 0 ? (
          <ul className="divide-y divide-border overflow-hidden rounded-xl ring-1 ring-border">
            {notes.map((n) => (
              <NoteRow
                key={n.id}
                note={n}
                showTopic={false}
                onPin={() => pin(n)}
                onArchive={() => archive(n, true)}
                onSaved={(p) => { patchLocal(n.id, p); void refresh(); }}
              />
            ))}
          </ul>
        ) : (
          !composing && <p className="text-[13px] text-muted-foreground">No notes yet.</p>
        )}
      </div>
    </Card>
  );
}

/** "4" → "4 meals a day"; anything longer as they wrote it. */
function mealsMeta(v?: string | null): string | null {
  if (!v) return null;
  return /^\d+$/.test(v.trim()) ? `${v.trim()} meals a day` : v;
}

function Fact({ label, attention, children, ...rest }: { label: string; attention?: boolean; children: ReactNode } & Record<`data-${string}`, string | undefined>) {
  return (
    <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-3 px-3 py-2.5" {...rest}>
      <dt className={cn("flex items-start gap-1.5 text-[13px] leading-6", attention ? "font-medium text-warning" : "text-muted-foreground")}>
        {attention ? <AlertTriangle className="mt-1 h-3.5 w-3.5 shrink-0" aria-hidden /> : null}
        {label}
      </dt>
      <dd className="min-w-0 break-words text-[15px] leading-6">{children}</dd>
    </div>
  );
}

/** Their words as written, cut to 4 lines with More when longer. */
function Clamp({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > 180 || text.split("\n").length > 4;
  return (
    <span className="block">
      <span className={cn("block whitespace-pre-line", long && !open && "line-clamp-4")}>{text}</span>
      {long ? (
        <button type="button" className="mt-0.5 text-[13px] font-medium text-foreground underline-offset-2 hover:underline" onClick={() => setOpen((v) => !v)}>
          {open ? "Less" : "More"}
        </button>
      ) : null}
    </span>
  );
}
