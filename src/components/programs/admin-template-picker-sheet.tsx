import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getClientGoalsSetupFn } from "@/lib/client-goals/goals.functions";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sparkles, Search, Check } from "lucide-react";
import { deriveFacets, facetChips, type FacetSource } from "@/lib/programs/facets";
import { rankRecommendations, type GoalsSetupInput } from "@/lib/programs/recommend";

type TemplateRow = {
  id: string;
  name: string;
  template_type: string | null;
  weeks: number | null;
  training_style: string | null;
  training_focus: string | null;
  goal: string | null;
  tags: string[] | null;
  days_per_week: number | null;
  est_duration_min: number | null;
  updated_at: string | null;
  payload?: any;
};

type Props = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  clientId?: string | null;
  clientName?: string | null;
  selectedId?: string | null;
  onSelect: (template: TemplateRow) => void;
};

export function AdminTemplatePickerSheet({
  open, onOpenChange, clientId, clientName, selectedId, onSelect,
}: Props) {
  const [q, setQ] = useState("");

  const { data: templates = [], isLoading } = useQuery({
    queryKey: ["pl-templates-picker"],
    enabled: open,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("pl_templates")
        .select("id, name, template_type, weeks, training_style, training_focus, goal, tags, days_per_week, est_duration_min, updated_at, payload")
        .in("template_type", ["block", "full_prep"])
        .eq("archived", false)
        .order("updated_at", { ascending: false });
      return (data ?? []) as TemplateRow[];
    },
  });

  const { data: goalsData } = useQuery({
    queryKey: ["client-goals-setup", clientId],
    enabled: open && !!clientId,
    queryFn: () => getClientGoalsSetupFn({ data: { clientId: clientId! } } as any),
  });
  const goals: GoalsSetupInput | null = (goalsData as any)?.goals ?? null;

  const enriched = useMemo(
    () => templates.map((t) => ({ program: t, facets: deriveFacets(t as FacetSource) })),
    [templates],
  );

  const recommended = useMemo(() => {
    if (!goals) return [];
    return rankRecommendations(enriched, goals, 5, 3);
  }, [enriched, goals]);
  const recommendedIds = new Set(recommended.map((r) => (r.program as TemplateRow).id));

  const ql = q.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!ql) return enriched;
    return enriched.filter(({ program, facets }) => {
      const hay = [
        program.name, program.training_focus, program.training_style, program.goal,
        ...facets.rawTags,
      ].filter(Boolean).join(" ").toLowerCase();
      return hay.includes(ql);
    });
  }, [enriched, ql]);

  const groups = useMemo(() => {
    const map = new Map<string, typeof enriched>();
    for (const item of filtered) {
      if (recommendedIds.has((item.program as TemplateRow).id)) continue;
      const key = item.program.training_focus || item.program.training_style || "Other";
      const list = map.get(key) ?? [];
      list.push(item);
      map.set(key, list);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered, recommendedIds]);

  const pick = (t: TemplateRow) => {
    onSelect(t);
    onOpenChange(false);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-lg flex flex-col p-0">
        <SheetHeader className="px-4 pt-4 pb-2 border-b border-border">
          <SheetTitle className="text-base">
            Choose Template{clientName ? ` for ${clientName}` : ""}
          </SheetTitle>
          <div className="relative mt-2">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search templates…"
              className="pl-8 h-9"
            />
          </div>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-3 py-3 space-y-4">
          {isLoading && (
            <p className="text-xs text-muted-foreground text-center py-4">Loading templates…</p>
          )}

          {!ql && recommended.length > 0 && (
            <section>
              <div className="flex items-center gap-1.5 px-1 mb-1.5">
                <Sparkles className="h-3.5 w-3.5 text-primary" />
                <h3 className="text-xs font-semibold uppercase tracking-wide">
                  Recommended for {clientName ?? "this client"}
                </h3>
              </div>
              <ul className="space-y-1.5">
                {recommended.map(({ program, facets, reasons }) => (
                  <TemplateRowItem
                    key={(program as TemplateRow).id}
                    template={program as TemplateRow}
                    chips={facetChips(facets)}
                    reasons={reasons}
                    selected={selectedId === (program as TemplateRow).id}
                    onPick={pick}
                    accent
                  />
                ))}
              </ul>
            </section>
          )}

          {groups.length === 0 && !isLoading && (
            <p className="text-xs text-muted-foreground text-center py-6">
              {ql ? "No templates match your search." : "No templates available."}
            </p>
          )}

          {groups.map(([heading, items]) => (
            <section key={heading}>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground px-1 mb-1.5">
                {heading} <span className="text-muted-foreground/60">· {items.length}</span>
              </h3>
              <ul className="space-y-1.5">
                {items.map(({ program, facets }) => (
                  <TemplateRowItem
                    key={(program as TemplateRow).id}
                    template={program as TemplateRow}
                    chips={facetChips(facets)}
                    selected={selectedId === (program as TemplateRow).id}
                    onPick={pick}
                  />
                ))}
              </ul>
            </section>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function TemplateRowItem({
  template, chips, reasons, selected, onPick, accent,
}: {
  template: TemplateRow;
  chips: string[];
  reasons?: string[];
  selected?: boolean;
  onPick: (t: TemplateRow) => void;
  accent?: boolean;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={() => onPick(template)}
        className={
          "w-full text-left rounded-md border p-2.5 transition hover:bg-secondary/50 " +
          (selected
            ? "border-primary bg-primary/5"
            : accent
              ? "border-primary/30 bg-primary/[0.03]"
              : "border-border bg-card")
        }
      >
        <div className="flex items-start gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <p className="text-sm font-medium leading-snug line-clamp-2">{template.name}</p>
              {selected && <Check className="h-3.5 w-3.5 text-primary shrink-0" />}
            </div>
            {reasons && reasons.length > 0 && (
              <p className="text-[11px] text-primary mt-0.5 line-clamp-1">
                ✓ {reasons[0]}
              </p>
            )}
            {chips.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1.5">
                {chips.slice(0, 4).map((c) => (
                  <Badge key={c} variant="secondary" className="text-[10px] px-1.5 py-0 h-4 font-normal">
                    {c}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        </div>
      </button>
    </li>
  );
}