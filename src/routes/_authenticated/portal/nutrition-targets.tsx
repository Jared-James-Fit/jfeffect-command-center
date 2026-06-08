import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { usePortalUserId } from "@/lib/client-impersonation";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Apple, Beef, Wheat, Droplets, Flame, Cookie, FileText, Download, ExternalLink } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { MealPlanDisplay } from "@/components/meal-plan-display";

export const Route = createFileRoute("/_authenticated/portal/nutrition-targets")({ component: NutritionTargets });

function NutritionTargets() {
  const portalUserId = usePortalUserId();

  const { data: client } = useQuery({
    queryKey: ["my-client", portalUserId],
    enabled: !!portalUserId,
    queryFn: async () => (await supabase.from("clients").select("id, full_name").eq("user_id", portalUserId!).maybeSingle()).data,
  });

  const { data: targets = [] } = useQuery({
    queryKey: ["my-nutrition-targets", client?.id],
    enabled: !!client?.id,
    queryFn: async () => {
      const { data } = await supabase
        .from("nutrition_targets")
        .select("*, nutrition_target_days(*)")
        .eq("client_id", client!.id)
        .neq("status", "Archived")
        .order("start_date", { ascending: false });
      return data ?? [];
    },
  });

  const current = targets[0] as any;

  return (
    <>
      <PageHeader title="Nutrition" subtitle={current ? (current.phase === "Custom" ? current.custom_phase : current.phase) : "Your assigned targets from Coach Jared."} />
      <div className="p-4 pb-28 md:p-8 md:pb-12 space-y-6">
        {!current ? (
          <Card className="border-border bg-card p-10 text-center">
            <Apple className="mx-auto h-10 w-10 text-primary" />
            <h2 className="mt-4 text-xl font-black">No targets assigned yet</h2>
            <p className="mt-2 text-sm text-muted-foreground">Your coach hasn't set up your nutrition targets. Check back soon.</p>
          </Card>
        ) : (
          <NutritionView current={current} />
        )}
      </div>
    </>
  );
}

function NutritionView({ current }: { current: any }) {
  const days = useMemo(
    () => [...(current.nutrition_target_days ?? [])].sort((a: any, b: any) => a.sort_order - b.sort_order),
    [current.nutrition_target_days],
  );
  const [activeId, setActiveId] = useState<string | null>(days[0]?.id ?? null);
  useEffect(() => {
    if (days.length && !days.find((d: any) => d.id === activeId)) setActiveId(days[0].id);
  }, [days, activeId]);
  const activeDay = days.find((d: any) => d.id === activeId) ?? days[0];

  return (
    <>
      <Card className="border-border bg-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Current goal</div>
            <div className="mt-0.5 text-base font-black">{current.goal === "Custom" ? current.custom_goal : current.goal}</div>
          </div>
          <div className="text-right text-[11px] text-muted-foreground">
            <div>{current.start_date} → {current.end_date ?? "ongoing"}</div>
            <div>Updated {new Date(current.last_updated_at).toLocaleDateString()}</div>
          </div>
        </div>
        {current.client_notes && (
          <div className="mt-3 rounded-md border border-primary/30 bg-primary/5 p-3 text-sm">{current.client_notes}</div>
        )}
      </Card>

      {days.length > 1 && (
        <div className="-mx-2 overflow-x-auto px-2">
          <div className="inline-flex rounded-md border border-border bg-secondary/30 p-1">
            {days.map((d: any) => (
              <button
                key={d.id}
                onClick={() => setActiveId(d.id)}
                className={
                  "rounded px-3 py-1.5 text-xs font-bold uppercase tracking-wider whitespace-nowrap transition " +
                  (d.id === activeDay?.id
                    ? "bg-gradient-primary text-primary-foreground shadow"
                    : "text-muted-foreground hover:text-foreground")
                }
              >
                {d.day_label}
              </button>
            ))}
          </div>
        </div>
      )}

      {activeDay && <DayPanel day={activeDay} />}

      {current.pdf_url && <PdfCard path={current.pdf_url} name={current.pdf_name} />}
    </>
  );
}

function DayPanel({ day }: { day: any }) {
  return (
    <Card className="border-border bg-card p-5 space-y-4">
      {/* Compact macro summary row */}
      <div className="rounded-md border border-primary/30 bg-primary/5 px-4 py-3">
        <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{day.day_label}</div>
        <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-2xl font-black">{day.calories ?? "—"}<span className="ml-1 text-xs font-normal text-muted-foreground">kcal</span></span>
          <span className="text-sm font-bold text-foreground/90">
            P {day.protein ?? "—"} <span className="text-muted-foreground">/</span> C {day.carbs ?? "—"} <span className="text-muted-foreground">/</span> F {day.fats ?? "—"}
          </span>
        </div>
      </div>

      {/* Detailed macro cards */}
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        <Macro icon={Flame} label="Cal" value={day.calories} unit="" />
        <Macro icon={Beef} label="Protein" value={day.protein} unit="g" />
        <Macro icon={Wheat} label="Carbs" value={day.carbs} unit="g" />
        <Macro icon={Cookie} label="Fats" value={day.fats} unit="g" />
        <Macro icon={Droplets} label="Water" value={day.water} unit="oz" />
        <Macro icon={Footprints} label="Steps" value={day.steps} unit="" />
      </div>
      {day.fibre != null && (
        <div className="text-xs"><span className="text-muted-foreground">Fibre:</span> <span className="font-semibold">{day.fibre}g</span></div>
      )}

      {day.notes && (
        <div>
          <div className="mb-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Meal Plan</div>
          <MealPlanDisplay text={day.notes} />
        </div>
      )}
    </Card>
  );
}

function PdfCard({ path, name }: { path: string; name?: string | null }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancel = false;
    supabase.storage.from("nutrition-plans").createSignedUrl(path, 60 * 60).then(({ data }) => {
      if (!cancel) setUrl(data?.signedUrl ?? null);
    });
    return () => { cancel = true; };
  }, [path]);

  return (
    <Card className="border-border bg-card p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <FileText className="h-7 w-7 text-primary" />
          <div>
            <div className="text-xs uppercase tracking-widest text-muted-foreground">Your Nutrition Plan</div>
            <div className="font-bold">{name || "Nutrition Plan.pdf"}</div>
          </div>
        </div>
        {url && (
          <div className="flex gap-2">
            <a href={url} target="_blank" rel="noreferrer">
              <Button size="sm" variant="outline"><ExternalLink className="mr-1 h-4 w-4" /> Open</Button>
            </a>
            <a href={url} download={name || "nutrition-plan.pdf"}>
              <Button size="sm" className="bg-gradient-primary font-bold uppercase"><Download className="mr-1 h-4 w-4" /> Download</Button>
            </a>
          </div>
        )}
      </div>
      {url && (
        <div className="mt-4 overflow-hidden rounded-md border border-border bg-secondary/30">
          <iframe src={url} title="Nutrition Plan" className="h-[70vh] w-full" />
        </div>
      )}
    </Card>
  );
}

function DayCard({ day }: { day: any }) {
  return (
    <Card className="border-border bg-card p-6">
      <h3 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">{day.day_label}</h3>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <Macro icon={Flame} label="Calories" value={day.calories} unit="kcal" />
        <Macro icon={Beef} label="Protein" value={day.protein} unit="g" />
        <Macro icon={Wheat} label="Carbs" value={day.carbs} unit="g" />
        <Macro icon={Cookie} label="Fats" value={day.fats} unit="g" />
        <Macro icon={Droplets} label="Water" value={day.water} unit="oz" />
        <Macro icon={Footprints} label="Steps" value={day.steps} unit="" />
      </div>
      {day.fibre != null && (
        <div className="mt-3 text-xs"><span className="text-muted-foreground">Fibre:</span> <span className="font-semibold">{day.fibre}g</span></div>
      )}
      {day.notes && (
        <div className="mt-4">
          <div className="mb-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Meal Plan</div>
          <MealPlanDisplay text={day.notes} />
        </div>
      )}
    </Card>
  );
}

function Macro({ icon: Icon, label, value, unit }: { icon: any; label: string; value: any; unit: string }) {
  return (
    <div className="rounded-md border border-border bg-secondary/30 p-2">
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-widest text-muted-foreground">
        <Icon className="h-3 w-3" /> {label}
      </div>
      <div className="mt-0.5 text-base font-black leading-tight">{value ?? "—"}{unit && <span className="ml-0.5 text-[10px] font-normal text-muted-foreground">{unit}</span>}</div>
    </div>
  );
}