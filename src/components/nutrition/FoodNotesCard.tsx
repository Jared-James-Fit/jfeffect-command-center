/**
 * Client profile → Nutrition → Food & diet: what to keep in mind before
 * touching their nutrition, read from their whole account (`loadFoodContext`
 * → food-history.ts, the same read every nutrition AI path uses):
 *
 * - Allergies, diets and health are sticky: anything they've said on any
 *   Nutrition Update, Goals & Setup or the coach's notes stays, with when it
 *   was said, even when a later form answers "None", until the coach marks it
 *   as no longer applying (`client_food_history_dismissals`; Put back undoes).
 * - Eats, Won't eat, Goal and Day to day are what they say now.
 * - History: every plan with how it went, the food changes asked for over
 *   time, and what they said before.
 * - Your notes: the coach's nutrition notes (`client_file_notes`, topic
 *   'nutrition'), which the AI follows.
 */
import { useMemo, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { AlertTriangle, MoreHorizontal, Plus, Salad } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Accordion } from "@/components/ui/accordion";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { CardHeader, Section } from "@/components/nutrition/nutrition-ui";
import { NoteRow } from "@/components/clients/client-file-notes";
import { getFoodHistoryFn } from "@/lib/nutrition-ai-plans.functions";
import {
  addClientFileNote,
  clientFileNotesKey,
  listClientFileNotes,
  setClientFileNoteArchived,
  sortActive,
  updateClientFileNote,
  type ClientFileNote,
} from "@/lib/client-file-notes";
import { foodHistoryKey, planResultLine, planSpan, saidWhen, type FoodHistory, type StickyFact } from "@/lib/nutrition-targets/food-history";
import type { FoodNotes } from "@/lib/nutrition-targets/food-notes";
import { cn } from "@/lib/utils";

const shortDate = (d?: string | null) =>
  d ? new Date(d.length === 10 ? `${d}T12:00:00Z` : d).toLocaleDateString([], { month: "short", day: "numeric", timeZone: d.length === 10 ? "UTC" : undefined }) : null;

type FoodRead = { history: FoodHistory; current: FoodNotes; latestAt: string | null; unit: "lb" | "kg" };

export function FoodNotesCard({ clientId, className }: { clientId: string; className?: string }) {
  const qc = useQueryClient();
  const readFn = useServerFn(getFoodHistoryFn);
  const key = foodHistoryKey(clientId);
  const { data, isLoading } = useQuery({
    queryKey: key,
    queryFn: () => readFn({ data: { clientId } }) as Promise<FoodRead>,
    staleTime: 30_000,
  });
  const notesKey = clientFileNotesKey(clientId);
  const { data: allNotes = [] } = useQuery({
    queryKey: notesKey,
    queryFn: () => listClientFileNotes(clientId),
    staleTime: 15_000,
  });
  const notes = useMemo(() => sortActive(allNotes.filter((n) => n.topic === "nutrition" && !n.archived_at)), [allNotes]);

  const [composing, setComposing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const refreshFood = () => qc.invalidateQueries({ queryKey: key });
  const patchLocal = (id: string, patch: Partial<ClientFileNote>) =>
    qc.setQueryData<ClientFileNote[]>(notesKey, (old) => (old ?? []).map((n) => (n.id === id ? { ...n, ...patch } : n)));
  const refreshNotes = () => {
    void qc.invalidateQueries({ queryKey: notesKey });
    void refreshFood();
  };

  const save = async () => {
    if (!draft.trim()) return;
    setSaving(true);
    try {
      const row = await addClientFileNote(clientId, "", draft, "nutrition");
      qc.setQueryData<ClientFileNote[]>(notesKey, (old) => [row, ...(old ?? [])]);
      setDraft("");
      setComposing(false);
      void refreshFood();
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
      refreshNotes();
    }
  };
  const pin = async (n: ClientFileNote) => {
    patchLocal(n.id, { pinned: !n.pinned });
    try {
      await updateClientFileNote(n.id, { pinned: !n.pinned });
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't update the note");
    } finally {
      refreshNotes();
    }
  };

  /** The coach's "doesn't apply anymore" on an allergy, diet or health fact; Put back takes it off. */
  const setDismissed = async (f: StickyFact, on: boolean) => {
    const table = (supabase as any).from("client_food_history_dismissals");
    const { error } = on
      ? await table.upsert({ client_id: clientId, kind: f.kind, key: f.key, created_at: new Date().toISOString() }, { onConflict: "client_id,kind,key" })
      : await table.delete().eq("client_id", clientId).eq("kind", f.kind).eq("key", f.key);
    if (error) {
      toast.error(error.message ?? "Couldn't update it");
      return;
    }
    await refreshFood();
    if (on) toast(`${f.label}: no longer applies. The AI stops planning around it.`, { action: { label: "Undo", onClick: () => void setDismissed(f, false) } });
    else toast.success(`${f.label} is back on file`);
  };

  const h = data?.history;
  const f = data?.current;
  const live = (xs: StickyFact[] = []) => xs.filter((x) => !x.dismissed);
  const removed = h ? [...h.allergies, ...h.diets, ...h.health].filter((x) => x.dismissed) : [];
  const dayToDay = f ? [...f.routine, ...f.style] : [];
  const sources = h
    ? [
        h.updates === 1
          ? `their ${shortDate(data?.latestAt) ?? ""} Nutrition Update`.replace("  ", " ")
          : h.updates > 1
            ? `${h.updates} Nutrition Updates${data?.latestAt ? ` (latest ${shortDate(data.latestAt)})` : ""}`
            : null,
        "Goals & Setup",
        notes.length ? "your notes" : null,
      ].filter(Boolean)
    : [];
  const historyCount = h ? h.plans.length + h.changes.length + Math.max(0, h.preferences.length - 1) + removed.length : 0;

  return (
    <Card className={cn("space-y-4 border-border bg-card p-4 md:p-6", className)} data-food-notes>
      <CardHeader icon={Salad} title="Food & diet" />

      {isLoading || !h || !f ? (
        <div className="space-y-2">
          <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
          <div className="h-24 animate-pulse rounded-xl bg-muted" />
        </div>
      ) : (
        <>
          <p className="text-[13px] text-muted-foreground">
            {h.updates || f.allergyState !== "unknown"
              ? `Everything on file from ${sources.join(", ")}. Allergies, diets and health stay until you say they don't apply.`
              : "Nothing on file yet. Their Nutrition Updates and Goals & Setup answers collect here."}
          </p>

          <dl className="divide-y divide-border rounded-xl border border-border">
            <Fact label="Allergies" attention={live(h.allergies).length > 0} data-allergies={live(h.allergies).length ? "some" : f.allergyState}>
              {live(h.allergies).length ? (
                <FactList facts={live(h.allergies)} onDismiss={(x) => setDismissed(x, true)} />
              ) : (
                <span className="text-muted-foreground">{h.updates || f.allergyState === "none" ? "None on file" : "Not asked yet"}</span>
              )}
            </Fact>
            {live(h.diets).length > 0 && (
              <Fact label="Diet">
                <FactList facts={live(h.diets)} onDismiss={(x) => setDismissed(x, true)} />
              </Fact>
            )}
            {live(h.health).length > 0 && (
              <Fact label="Health" attention>
                <FactList facts={live(h.health)} onDismiss={(x) => setDismissed(x, true)} />
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

          {(dayToDay.length > 0 || historyCount > 0) && (
            <Accordion type="multiple" className="rounded-xl border border-border">
              {dayToDay.length > 0 && (
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
              )}
              {historyCount > 0 && (
                <Section value="history" title="History" meta={historyMeta(h)}>
                  <div className="space-y-4" data-food-history>
                    {h.plans.length > 0 && (
                      <HistoryGroup title="Plans and how they went">
                        {h.plans.map((p) => (
                          <li key={p.id} className="py-2">
                            <div className="text-[14px] font-medium">
                              {planSpan(p)}
                              {p.phase ? ` · ${p.phase}` : ""}
                              {p.kcal ? <span className="font-normal text-muted-foreground"> · ~{p.kcal.toLocaleString("en-US")} kcal a day</span> : null}
                            </div>
                            <div className="text-[13px] text-muted-foreground">{planResultLine(p, data!.unit)}</div>
                          </li>
                        ))}
                      </HistoryGroup>
                    )}
                    {h.changes.length > 0 && (
                      <HistoryGroup title="Food changes asked for">
                        {h.changes.map((c, i) => (
                          <li key={`${c.at}-${i}`} className="py-2 text-[14px]">
                            <span className="text-muted-foreground">{shortDate(c.at)} · {c.by === "coach" ? "You" : "They asked"}:</span> {c.text}
                          </li>
                        ))}
                      </HistoryGroup>
                    )}
                    {h.preferences.length > 1 && (
                      <HistoryGroup title="Foods they listed before">
                        {h.preferences.slice(1).map((p, i) => (
                          <li key={`${p.at}-${i}`} className="py-2 text-[14px]">
                            <span className="text-muted-foreground">{shortDate(p.at)}:</span> <span className="whitespace-pre-line">{p.text}</span>
                          </li>
                        ))}
                      </HistoryGroup>
                    )}
                    {removed.length > 0 && (
                      <HistoryGroup title="No longer applies">
                        {removed.map((x) => (
                          <li key={`${x.kind}:${x.key}`} className="flex items-center justify-between gap-2 py-1.5 text-[14px]">
                            <span className="min-w-0">
                              {x.label} <span className="text-muted-foreground">· you, {shortDate(x.dismissed!.at)}</span>
                            </span>
                            <Button variant="ghost" size="sm" className="h-9 shrink-0" onClick={() => setDismissed(x, false)}>
                              Put back
                            </Button>
                          </li>
                        ))}
                      </HistoryGroup>
                    )}
                  </div>
                </Section>
              )}
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
                onSaved={(p) => { patchLocal(n.id, p); refreshNotes(); }}
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

/** "2 plans · 1 change": what the History section holds. */
function historyMeta(h: FoodHistory): string {
  return [
    h.plans.length ? `${h.plans.length} ${h.plans.length === 1 ? "plan" : "plans"}` : null,
    h.changes.length ? `${h.changes.length} ${h.changes.length === 1 ? "change" : "changes"}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Each allergy / diet / health fact on file: what it is, when and where it was said, their words, and ⋯ to say it doesn't apply. */
function FactList({ facts, onDismiss }: { facts: StickyFact[]; onDismiss: (f: StickyFact) => void }) {
  return (
    <ul className="space-y-2">
      {facts.map((x) => {
        const said = x.mentions[0];
        const words = said && said.text.trim().toLowerCase() !== x.label.toLowerCase() ? said.text.trim() : null;
        return (
          <li key={`${x.kind}:${x.key}`} className="flex items-start gap-1" data-fact={x.kind}>
            <div className="min-w-0 flex-1">
              <div className="break-words">{x.label}</div>
              <div className="text-[13px] leading-5 text-muted-foreground">
                <span className="whitespace-nowrap">{saidWhen(x)}</span> · {sourcesOf(x)}
              </div>
              {words ? <div className="line-clamp-2 text-[13px] leading-5 text-muted-foreground">“{words}”</div> : null}
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="-mr-2 h-10 w-10 shrink-0 text-muted-foreground" aria-label={`${x.label} options`}>
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem onClick={() => onDismiss(x)}>Doesn't apply anymore</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </li>
        );
      })}
    </ul>
  );
}

/** "Nutrition Update, Goals & Setup": where a fact was said. */
function sourcesOf(f: StickyFact): string {
  const seen = [...new Set(f.mentions.map((m) => m.source))];
  // one form can say it twice (the allergy box and the foods box): count the forms
  const n = new Set(f.mentions.filter((m) => m.source === "Nutrition Update").map((m) => m.at)).size;
  return seen.map((s) => (s === "Nutrition Update" && n > 1 ? `${n} Nutrition Updates` : s)).join(", ");
}

function HistoryGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <div className="text-[13px] font-medium text-muted-foreground">{title}</div>
      <ul className="divide-y divide-border">{children}</ul>
    </div>
  );
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
