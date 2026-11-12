/**
 * Client profile → Summary (and Training → Athlete setup) → Health: everything
 * on file about the client's health in one place (health-profile.ts, the same
 * read the nutrition AI, its supplement advice and the program AI use):
 * injuries, pain after workouts, conditions, medications, supplements they
 * take, allergies and diet, drug testing and their supplement budget.
 *
 * What the coach or client added (client_health_items) is edited here; what
 * they said on a form is marked "doesn't apply anymore" like on Food & diet
 * (client_food_history_dismissals). Allergies and diets are the Food & diet
 * card's (they shape every meal plan), shown here so nothing is missed.
 */
import { useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { AlertTriangle, HeartPulse, Lock, MoreHorizontal, Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Accordion } from "@/components/ui/accordion";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { CardHeader, Section } from "@/components/nutrition/nutrition-ui";
import { HealthItemSheet, type HealthSheetTarget } from "@/components/health/health-item-sheet";
import { getHealthProfileFn } from "@/lib/health/health.functions";
import { BUDGET_LABELS, healthProfileKey, PAIN_WEEKS, type HealthEntry, type HealthProfile, type SupplementBudget } from "@/lib/health/health-profile";
import { foodHistoryKey } from "@/lib/nutrition-targets/food-history";
import { cn } from "@/lib/utils";

const shortDate = (d?: string | null) =>
  d ? new Date(d.length === 10 ? `${d}T12:00:00Z` : d).toLocaleDateString([], { month: "short", day: "numeric", timeZone: d.length === 10 ? "UTC" : undefined }) : null;

export function useHealthProfile(clientId: string) {
  const readFn = useServerFn(getHealthProfileFn);
  return useQuery({
    queryKey: healthProfileKey(clientId),
    queryFn: async () => (await readFn({ data: { clientId } })).health as HealthProfile,
    staleTime: 30_000,
  });
}

export function HealthCard({ clientId, className, bare }: { clientId: string; className?: string; bare?: boolean }) {
  const qc = useQueryClient();
  const { data: p, isLoading } = useHealthProfile(clientId);
  const [target, setTarget] = useState<HealthSheetTarget>(null);
  const [settingsOpen, setSettingsOpen] = useState<string[]>([]);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: healthProfileKey(clientId) });
    void qc.invalidateQueries({ queryKey: foodHistoryKey(clientId) });
  };

  const setResolved = async (e: HealthEntry, on: boolean) => {
    if (!e.item) return;
    const { error } = await (supabase as any)
      .from("client_health_items")
      .update(on ? { status: "resolved", resolved_on: new Date().toISOString().slice(0, 10) } : { status: "active", resolved_on: null })
      .eq("id", e.item.id);
    if (error) return void toast.error(error.message ?? "Couldn't update it");
    refresh();
    if (on) toast(`${e.label}: resolved. The AI stops planning around it.`, { action: { label: "Undo", onClick: () => void setResolved(e, false) } });
  };

  const setDismissed = async (e: HealthEntry, on: boolean) => {
    if (!e.fact) return;
    const t = (supabase as any).from("client_food_history_dismissals");
    const { error } = on
      ? await t.upsert({ client_id: clientId, kind: e.fact.kind, key: e.fact.key, created_at: new Date().toISOString() }, { onConflict: "client_id,kind,key" })
      : await t.delete().eq("client_id", clientId).eq("kind", e.fact.kind).eq("key", e.fact.key);
    if (error) return void toast.error(error.message ?? "Couldn't update it");
    refresh();
    if (on) toast(`${e.label}: no longer applies.`, { action: { label: "Undo", onClick: () => void setDismissed(e, false) } });
  };

  const saveSettings = async (patch: { drug_tested?: boolean | null; federation?: string | null; supplement_budget?: SupplementBudget | null }) => {
    const current = { drug_tested: p?.drugTested ?? null, federation: p?.federation ?? null, supplement_budget: p?.budgetFrom === "coach" ? p.budget : null };
    const { error } = await (supabase as any)
      .from("client_health_profiles")
      .upsert({ client_id: clientId, ...current, ...patch }, { onConflict: "client_id" });
    if (error) return void toast.error(error.message ?? "Couldn't save it");
    refresh();
  };

  const body = (
    <>
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <CardHeader icon={HeartPulse} title="Health" />
        </div>
        <Button variant="outline" size="sm" className="h-10 shrink-0 gap-1" onClick={() => setTarget({})} data-health-add>
          <Plus className="h-4 w-4" /> Add
        </Button>
      </div>

      {isLoading || !p ? (
        <div className="space-y-2">
          <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
          <div className="h-20 animate-pulse rounded-xl bg-muted" />
        </div>
      ) : (
        <>
          <p className="text-[13px] text-muted-foreground">
            {p.empty
              ? "Nothing on file yet. Add an injury, condition, medication or supplement, or they can add it in their app (Account → Health & injuries)."
              : "What you and they added, Goals & Setup, their Nutrition Updates and workout check-outs. Their nutrition, supplements and programs are planned around it."}
          </p>

          {!p.empty && (
            <dl className="divide-y divide-border rounded-xl border border-border" data-health-profile>
              {p.injuries.length > 0 && (
                <Row label="Injuries" attention>
                  <Entries entries={p.injuries} onEdit={(e) => setTarget({ item: e.item })} onResolve={(e) => setResolved(e, true)} onDismiss={(e) => setDismissed(e, true)} />
                </Row>
              )}
              {p.pain.length > 0 && (
                <Row label="Pain" attention>
                  <ul className="space-y-2">
                    {p.pain.map((a) => (
                      <li key={a.area}>
                        <div className="first-letter:uppercase">{a.area}</div>
                        <div className="text-[13px] leading-5 text-muted-foreground">
                          {a.count}× after workouts · last {shortDate(a.last)}
                          {a.worst != null ? ` · worst ${a.worst}/10` : ""}
                        </div>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-1 text-[12px] text-muted-foreground">Last {PAIN_WEEKS} weeks of check-outs.</p>
                </Row>
              )}
              {p.conditions.length > 0 && (
                <Row label="Conditions" attention>
                  <Entries entries={p.conditions} onEdit={(e) => setTarget({ item: e.item })} onResolve={(e) => setResolved(e, true)} onDismiss={(e) => setDismissed(e, true)} />
                </Row>
              )}
              {p.medications.length > 0 && (
                <Row label="Medications">
                  <Entries entries={p.medications} onEdit={(e) => setTarget({ item: e.item })} onResolve={(e) => setResolved(e, true)} onDismiss={(e) => setDismissed(e, true)} />
                </Row>
              )}
              {p.supplements.length > 0 && (
                <Row label="Takes">
                  <Entries entries={p.supplements} onEdit={(e) => setTarget({ item: e.item })} onResolve={(e) => setResolved(e, true)} onDismiss={(e) => setDismissed(e, true)} />
                </Row>
              )}
              {(p.allergies.length > 0 || p.diets.length > 0) && (
                <Row label="Food" attention={p.allergies.length > 0}>
                  <span>
                    {[...p.allergies.map((a) => `${a.label} allergy`), ...p.diets.map((d) => d.label)].join(" · ")}
                  </span>
                  <p className="mt-0.5 text-[12px] text-muted-foreground">Kept on Nutrition → Food & diet, checked on every meal plan.</p>
                </Row>
              )}
            </dl>
          )}

          <Accordion type="multiple" value={settingsOpen} onValueChange={setSettingsOpen} className="rounded-xl border border-border">
            <Section
              value="sport"
              title="Drug testing & supplements"
              meta={`${p.drugTested == null ? "Not set" : p.drugTested ? "Tested" : "Not tested"} · ${p.budget === "essentials" ? "Essentials" : p.budget === "some" ? "Some extras" : "Open"}`}
            >
              <SportSettings profile={p} onSave={saveSettings} />
            </Section>
            {p.past.length > 0 && (
              <Section value="past" title="Resolved" meta={`${p.past.length}`}>
                <ul className="divide-y divide-border">
                  {p.past.map((e) => (
                    <li key={e.id} className="flex items-center justify-between gap-2 py-2 text-[14px]">
                      <span className="min-w-0">
                        {e.label}
                        <span className="text-muted-foreground"> · {e.item ? `resolved ${shortDate(e.item.resolved_on) ?? ""}` : `no longer applies, ${shortDate(e.at)}`}</span>
                      </span>
                      <Button variant="ghost" size="sm" className="h-9 shrink-0" onClick={() => (e.item ? setResolved(e, false) : setDismissed(e, false))}>
                        Put back
                      </Button>
                    </li>
                  ))}
                </ul>
              </Section>
            )}
          </Accordion>
        </>
      )}

      <HealthItemSheet clientId={clientId} mode="coach" target={target} onClose={() => setTarget(null)} onSaved={refresh} />
    </>
  );

  if (bare) return <div className={cn("space-y-4", className)}>{body}</div>;
  return (
    <Card id="health" className={cn("scroll-mt-24 space-y-4 border-border bg-card p-4 md:p-6", className)} data-health-card>
      {body}
    </Card>
  );
}

function Row({ label, attention, children }: { label: string; attention?: boolean; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-3 px-3 py-2.5">
      <dt className={cn("flex items-start gap-1.5 text-[13px] leading-6", attention ? "font-medium text-warning" : "text-muted-foreground")}>
        {attention ? <AlertTriangle className="mt-1 h-3.5 w-3.5 shrink-0" aria-hidden /> : null}
        {label}
      </dt>
      <dd className="min-w-0 break-words text-[15px] leading-6">{children}</dd>
    </div>
  );
}

function Entries({
  entries,
  onEdit,
  onResolve,
  onDismiss,
}: {
  entries: HealthEntry[];
  onEdit: (e: HealthEntry) => void;
  onResolve: (e: HealthEntry) => void;
  onDismiss: (e: HealthEntry) => void;
}) {
  return (
    <ul className="space-y-2">
      {entries.map((e) => (
        <li key={e.id} className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="break-words">
              {e.label}
              {e.area && !e.label.toLowerCase().includes(e.area.toLowerCase()) ? <span className="font-normal text-muted-foreground"> · {e.area}</span> : null}
              {e.coachOnly ? <Lock className="ml-1 inline h-3.5 w-3.5 text-muted-foreground" aria-label="Only you see it" /> : null}
            </div>
            {e.details ? <div className="line-clamp-3 whitespace-pre-line text-[13px] leading-5 text-muted-foreground">{e.details}</div> : null}
            <div className="text-[13px] leading-5 text-muted-foreground">
              {e.said ? `Said ${e.said} · ${e.fromLabel}` : `${e.fromLabel === "You" ? "You" : e.fromLabel === "Them" ? "They added it" : e.fromLabel}, ${shortDate(e.at)}`}
              {e.since ? ` · since ${shortDate(e.since)}` : ""}
            </div>
          </div>
          {(e.item || e.fact) && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0" aria-label={`More for ${e.label}`}>
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {e.item ? (
                  <>
                    <DropdownMenuItem onSelect={() => onEdit(e)}>Edit</DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => onResolve(e)}>{e.kind === "injury" ? "Healed" : "Doesn't apply anymore"}</DropdownMenuItem>
                  </>
                ) : (
                  <DropdownMenuItem onSelect={() => onDismiss(e)}>Doesn't apply anymore</DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </li>
      ))}
    </ul>
  );
}

function SportSettings({ profile, onSave }: { profile: HealthProfile; onSave: (patch: { drug_tested?: boolean | null; federation?: string | null; supplement_budget?: SupplementBudget | null }) => Promise<void> }) {
  const [federation, setFederation] = useState(profile.federation ?? "");
  const chip = (on: boolean) =>
    cn("h-10 rounded-full border px-4 text-[14px] transition", on ? "border-foreground bg-foreground text-background" : "border-border bg-card hover:bg-muted");
  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <div className="text-[13px] font-medium">Competes drug-tested?</div>
        <div className="flex flex-wrap gap-2">
          {[
            { v: true, l: "Yes" },
            { v: false, l: "No" },
            { v: null, l: "Not set" },
          ].map((o) => (
            <button key={String(o.v)} type="button" className={chip(profile.drugTested === o.v)} onClick={() => void onSave({ drug_tested: o.v })}>
              {o.l}
            </button>
          ))}
        </div>
        {profile.drugTested && (
          <div className="flex gap-2 pt-1">
            <Input value={federation} onChange={(e) => setFederation(e.target.value)} placeholder="Federation (e.g. CPU / IPF)" maxLength={80} className="h-11 text-[16px]" />
            <Button variant="outline" className="h-11 shrink-0" disabled={federation.trim() === (profile.federation ?? "")} onClick={() => void onSave({ federation: federation.trim() || null })}>
              Save
            </Button>
          </div>
        )}
        <p className="text-[12px] text-muted-foreground">Tested athletes only get third-party-certified supplements, with a Global DRO check for medications.</p>
      </div>
      <div className="space-y-1.5">
        <div className="text-[13px] font-medium">Supplement budget</div>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(BUDGET_LABELS) as SupplementBudget[]).map((b) => (
            <button key={b} type="button" className={chip(profile.budget === b)} onClick={() => void onSave({ supplement_budget: b })}>
              {BUDGET_LABELS[b]}
            </button>
          ))}
        </div>
        <p className="text-[12px] text-muted-foreground">
          {profile.budgetFrom === "coach" ? "Set by you." : profile.budgetFrom === "form" ? "From their last Nutrition Update." : "Not asked yet: the essentials until they answer."}
        </p>
      </div>
    </div>
  );
}
