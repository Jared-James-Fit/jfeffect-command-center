import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Plus, Trash2, Save, GripVertical, ChevronUp, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { SettingsTabs } from "@/components/settings/settings-tabs";

export const Route = createFileRoute("/_authenticated/admin/faqs")({ component: FaqsAdmin });

const CATEGORIES = [
  { key: "nutrition", label: "Nutrition FAQ" },
  { key: "workouts", label: "Workouts FAQ" },
  { key: "cardio", label: "Cardio FAQ" },
  { key: "training_help", label: "Training Help" },
] as const;

const TRAINING_HELP_SUBCATEGORIES = [
  "RPE / RIR",
  "Warm-Ups",
  "Powerlifting",
  "Exercise Terms",
  "Logging Workouts",
  "Cardio",
  "Common Questions",
];

function FaqsAdmin() {
  return (
    <>
      <SettingsTabs />
      <PageHeader title="FAQ Manager" subtitle="Create and curate FAQs shown to clients at the top of each section. Only categories with entries appear in the portal." />
      <div className="p-4 md:p-8">
        <Tabs defaultValue="nutrition">
          <TabsList>
            {CATEGORIES.map((c) => (
              <TabsTrigger key={c.key} value={c.key}>{c.label}</TabsTrigger>
            ))}
          </TabsList>
          {CATEGORIES.map((c) => (
            <TabsContent key={c.key} value={c.key} className="mt-4">
              <CategoryEditor category={c.key} title={c.label} />
            </TabsContent>
          ))}
        </Tabs>
      </div>
    </>
  );
}

function CategoryEditor({ category, title }: { category: string; title: string }) {
  const qc = useQueryClient();
  const { data: faqs = [], isLoading } = useQuery({
    queryKey: ["admin-faqs", category],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("coach_faqs")
        .select("*")
        .eq("category", category)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["admin-faqs", category] });
    qc.invalidateQueries({ queryKey: ["faqs", category] });
  };

  const addOne = async () => {
    const nextSort = (faqs[faqs.length - 1]?.sort_order ?? -1) + 1;
    const { error } = await supabase.from("coach_faqs").insert({
      category,
      question: "",
      answer: "",
      sort_order: nextSort,
      active: true,
      ...(category === "training_help"
        ? { subcategory: "Common Questions", visible_coaching: true, visible_membership: true, visible_everyone: true }
        : {}),
    });
    if (error) return toast.error(error.message);
    invalidate();
  };

  const move = async (idx: number, dir: -1 | 1) => {
    const a = faqs[idx];
    const b = faqs[idx + dir];
    if (!a || !b) return;
    await supabase.from("coach_faqs").update({ sort_order: b.sort_order }).eq("id", a.id);
    await supabase.from("coach_faqs").update({ sort_order: a.sort_order }).eq("id", b.id);
    invalidate();
  };

  return (
    <Card className="border-border bg-card p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-black">{title}</h2>
          <p className="text-xs text-muted-foreground">Shown at the top of the client's matching section. Paste questions and answers below.</p>
        </div>
        <Button size="sm" className="bg-gradient-primary font-bold uppercase" onClick={addOne}>
          <Plus className="mr-1 h-4 w-4" /> Add FAQ
        </Button>
      </div>
      {isLoading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : faqs.length === 0 ? (
        <div className="rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          No FAQs yet. Add your first one — clients won't see this section until you do.
        </div>
      ) : (
        <ul className="space-y-3">
          {faqs.map((f, idx) => (
            <li key={f.id}>
              <FaqRow
                faq={f}
                isTrainingHelp={category === "training_help"}
                onChanged={invalidate}
                onUp={idx > 0 ? () => move(idx, -1) : undefined}
                onDown={idx < faqs.length - 1 ? () => move(idx, 1) : undefined}
              />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function FaqRow({ faq, isTrainingHelp, onChanged, onUp, onDown }: { faq: any; isTrainingHelp?: boolean; onChanged: () => void; onUp?: () => void; onDown?: () => void }) {
  const [question, setQuestion] = useState(faq.question);
  const [answer, setAnswer] = useState(faq.answer);
  const [active, setActive] = useState(faq.active);
  const [subcategory, setSubcategory] = useState<string>(faq.subcategory ?? "Common Questions");
  const [examples, setExamples] = useState<string>(faq.examples ?? "");
  const [visEveryone, setVisEveryone] = useState<boolean>(faq.visible_everyone ?? true);
  const [visCoaching, setVisCoaching] = useState<boolean>(faq.visible_coaching ?? true);
  const [visMembership, setVisMembership] = useState<boolean>(faq.visible_membership ?? true);
  const [saving, setSaving] = useState(false);
  const dirty =
    question !== faq.question ||
    answer !== faq.answer ||
    active !== faq.active ||
    (isTrainingHelp &&
      (subcategory !== (faq.subcategory ?? "Common Questions") ||
        examples !== (faq.examples ?? "") ||
        visEveryone !== (faq.visible_everyone ?? true) ||
        visCoaching !== (faq.visible_coaching ?? true) ||
        visMembership !== (faq.visible_membership ?? true)));

  const save = async () => {
    setSaving(true);
    const patch: any = { question, answer, active };
    if (isTrainingHelp) {
      patch.subcategory = subcategory;
      patch.examples = examples || null;
      patch.visible_everyone = visEveryone;
      patch.visible_coaching = visCoaching;
      patch.visible_membership = visMembership;
    }
    const { error } = await supabase.from("coach_faqs").update(patch).eq("id", faq.id);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Saved");
    onChanged();
  };

  const del = async () => {
    if (!confirm("Delete this FAQ?")) return;
    const { error } = await supabase.from("coach_faqs").delete().eq("id", faq.id);
    if (error) return toast.error(error.message);
    onChanged();
  };

  return (
    <div className="rounded-md border border-border bg-secondary/20 p-3 space-y-2">
      <div className="flex items-center gap-2">
        <GripVertical className="h-4 w-4 text-muted-foreground" />
        <div className="flex flex-col">
          <Button size="icon" variant="ghost" className="h-5 w-5" onClick={onUp} disabled={!onUp}><ChevronUp className="h-3 w-3" /></Button>
          <Button size="icon" variant="ghost" className="h-5 w-5" onClick={onDown} disabled={!onDown}><ChevronDown className="h-3 w-3" /></Button>
        </div>
        <Input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Question" className="font-semibold" />
        <div className="flex items-center gap-1">
          <Switch checked={active} onCheckedChange={setActive} />
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{active ? "Live" : "Hidden"}</span>
        </div>
        <Button size="sm" variant="ghost" className="text-destructive" onClick={del}><Trash2 className="h-4 w-4" /></Button>
      </div>
      <Textarea
        value={answer}
        onChange={(e) => setAnswer(e.target.value)}
        placeholder="Answer — paste freely, supports multiple lines"
        rows={4}
      />
      {isTrainingHelp && (
        <div className="space-y-2 pt-1 border-t border-border/60">
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Category</label>
            <select
              value={subcategory}
              onChange={(e) => setSubcategory(e.target.value)}
              className="h-8 rounded-md border border-border bg-background px-2 text-xs"
            >
              {TRAINING_HELP_SUBCATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          <Textarea
            value={examples}
            onChange={(e) => setExamples(e.target.value)}
            placeholder="Examples (optional) — one per line"
            rows={3}
          />
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <label className="flex items-center gap-1.5">
              <Switch checked={visEveryone} onCheckedChange={setVisEveryone} /> Everyone
            </label>
            <label className="flex items-center gap-1.5">
              <Switch checked={visCoaching} onCheckedChange={setVisCoaching} /> Coaching clients
            </label>
            <label className="flex items-center gap-1.5">
              <Switch checked={visMembership} onCheckedChange={setVisMembership} /> JF Membership
            </label>
          </div>
        </div>
      )}
      {dirty && (
        <div className="flex justify-end">
          <Button size="sm" className="bg-gradient-primary font-bold uppercase" onClick={save} disabled={saving}>
            <Save className="mr-1 h-4 w-4" /> {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      )}
    </div>
  );
}