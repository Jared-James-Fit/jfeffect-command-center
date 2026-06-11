import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { HelpCircle, Search } from "lucide-react";
import { usePortalUserId } from "@/lib/client-impersonation";

const CATEGORY_ORDER = [
  "RPE / RIR",
  "Warm-Ups",
  "Powerlifting",
  "Exercise Terms",
  "Logging Workouts",
  "Cardio",
  "Common Questions",
];

type Faq = {
  id: string;
  subcategory: string | null;
  question: string;
  answer: string;
  examples: string | null;
  visible_coaching: boolean;
  visible_membership: boolean;
  visible_everyone: boolean;
  sort_order: number;
};

export function TrainingHelpButton({
  size = "sm",
  variant = "outline",
  className,
  label = "Help",
}: {
  size?: "sm" | "default" | "lg" | "icon";
  variant?: "outline" | "default" | "ghost" | "secondary";
  className?: string;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        size={size}
        variant={variant}
        className={className}
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        type="button"
      >
        <HelpCircle className="mr-1 h-3 w-3" /> {label}
      </Button>
      <TrainingHelpSheet open={open} onOpenChange={setOpen} />
    </>
  );
}

export function TrainingHelpSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const portalUserId = usePortalUserId();

  // Detect role flags so visibility filters apply correctly. Both default queries
  // are cheap and cached; the sheet still renders instantly using `visible_everyone`.
  const { data: isCoaching = false } = useQuery({
    queryKey: ["help-is-coaching", portalUserId],
    enabled: !!portalUserId && open,
    queryFn: async () => {
      const { data } = await supabase
        .from("clients").select("id").eq("user_id", portalUserId!).maybeSingle();
      return !!data;
    },
  });
  const { data: isMembership = false } = useQuery({
    queryKey: ["help-is-membership", portalUserId],
    enabled: !!portalUserId && open,
    queryFn: async () => {
      const { data } = await supabase
        .from("app_members").select("id").eq("user_id", portalUserId!).maybeSingle();
      return !!data;
    },
  });

  const { data: faqs = [] } = useQuery({
    queryKey: ["training-help-faqs"],
    enabled: open,
    queryFn: async () => {
      const { data } = await supabase
        .from("coach_faqs")
        .select("id,subcategory,question,answer,examples,visible_coaching,visible_membership,visible_everyone,sort_order")
        .eq("category", "training_help")
        .eq("active", true)
        .order("sort_order", { ascending: true });
      return (data ?? []) as Faq[];
    },
    staleTime: 5 * 60 * 1000,
  });

  const [search, setSearch] = useState("");
  const [activeCat, setActiveCat] = useState<string>("All");

  const visible = useMemo(() => {
    return faqs.filter((f) => {
      if (f.visible_everyone) return true;
      if (isCoaching && f.visible_coaching) return true;
      if (isMembership && f.visible_membership) return true;
      return false;
    });
  }, [faqs, isCoaching, isMembership]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return visible.filter((f) => {
      if (activeCat !== "All" && (f.subcategory ?? "Common Questions") !== activeCat) return false;
      if (!q) return true;
      const hay = `${f.question} ${f.answer} ${f.examples ?? ""} ${f.subcategory ?? ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [visible, search, activeCat]);

  const categories = useMemo(() => {
    const present = new Set<string>();
    visible.forEach((f) => present.add(f.subcategory ?? "Common Questions"));
    const ordered = CATEGORY_ORDER.filter((c) => present.has(c));
    const extras = Array.from(present).filter((c) => !CATEGORY_ORDER.includes(c));
    return ["All", ...ordered, ...extras];
  }, [visible]);

  const grouped = useMemo(() => {
    const m = new Map<string, Faq[]>();
    filtered.forEach((f) => {
      const k = f.subcategory ?? "Common Questions";
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(f);
    });
    return Array.from(m.entries());
  }, [filtered]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-lg flex flex-col p-0">
        <SheetHeader className="px-5 pt-5 pb-3 border-b">
          <SheetTitle className="flex items-center gap-2">
            <HelpCircle className="h-5 w-5 text-primary" /> Training Help
          </SheetTitle>
          <SheetDescription>
            Quick answers to common training terms — RPE, RIR, warm-ups, tempo, AMRAP, and more.
          </SheetDescription>
        </SheetHeader>

        <div className="px-5 py-3 border-b space-y-3 bg-background">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9 h-11"
              placeholder="Search RPE, warmup, tempo, AMRAP…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoFocus={false}
            />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {categories.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setActiveCat(c)}
                className={`px-2.5 py-1 rounded-full text-xs font-medium border transition ${
                  activeCat === c
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-secondary/40 text-foreground border-border hover:bg-secondary"
                }`}
              >
                {c}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 pb-[max(env(safe-area-inset-bottom),1rem)] space-y-5">
          {grouped.length === 0 && (
            <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              No matching help article.
              <div className="mt-1 text-xs">Message your coach if you are unsure.</div>
            </div>
          )}
          {grouped.map(([cat, items]) => (
            <div key={cat} className="space-y-2">
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-[10px] uppercase tracking-wider">
                  {cat}
                </Badge>
              </div>
              <div className="space-y-2">
                {items.map((f) => (
                  <div
                    key={f.id}
                    className="rounded-lg border border-border bg-card p-3"
                  >
                    <div className="font-bold text-sm">{f.question}</div>
                    <p className="mt-1 text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed">
                      {f.answer}
                    </p>
                    {f.examples && (
                      <div className="mt-2 rounded-md bg-secondary/40 p-2 text-xs whitespace-pre-wrap leading-relaxed">
                        <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">
                          Example
                        </div>
                        {f.examples}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}