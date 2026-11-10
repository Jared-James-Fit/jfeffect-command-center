import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Copy, ClipboardPaste, Check, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { phaseFromPlanText } from "@/lib/nutrition-cardio";
import { quickPastePrompt, type ClientBasics, type QA, type WorkoutMealsMode } from "@/lib/nutrition-ai-prompts";
import { currentRequest } from "@/lib/form-request-state";
import { listNutritionRequestsFn } from "@/lib/nutrition-ai-plans.functions";
import type { TrainingPattern } from "@/lib/nutrition-targets/training-pattern";
import { plainPastedText } from "@/lib/nutrition-targets/plain-paste";

export type ParsedDay = {
  day_label: string;
  calories?: number | null;
  protein?: number | null;
  carbs?: number | null;
  fats?: number | null;
  fibre?: number | null;
  notes?: string | null;
  sort_order: number;
};

const EXAMPLE_TEMPLATE = `PHASE: Fat Loss

TRAINING-DAY MENU

Meal 1
300 g zero-fat Greek yogurt
50 g dry oats
30 g whey protein
150 g berries
15 g natural peanut butter

Approximate macros:
67 g protein
68 g carbohydrates
13 g fat
10 g fibre


Meal 2
160 g cooked chicken breast
260 g cooked white or jasmine rice
150 g vegetables
15 g olive oil

Approximate macros:
60 g protein
83 g carbohydrates
22 g fat
7 g fibre


Meal 3
180 g cooked lean ground turkey
325 g cooked potatoes
150 g vegetables
10 g olive oil

Approximate macros:
58 g protein
79 g carbohydrates
25 g fat
8 g fibre


Daily Total
Approximately 185 g protein, 230 g carbohydrates, 60 g fat and 25 g fibre


Being slightly over the protein target is acceptable.

NON-TRAINING-DAY MENU

Meal 1
300 g zero-fat Greek yogurt
40 g dry oats
30 g whey protein
100 g berries
20 g natural peanut butter

Approximate macros:
66 g protein
56 g carbohydrates
15 g fat
9 g fibre


Meal 2
180 g cooked chicken breast
180 g cooked white or jasmine rice
150 g vegetables
20 g olive oil

Approximate macros:
64 g protein
61 g carbohydrates
28 g fat
6 g fibre


Meal 3
180 g cooked lean ground turkey
180 g cooked potatoes
150 g vegetables
8 g olive oil

Approximate macros:
55 g protein
48 g carbohydrates
23 g fat
6 g fibre


Daily Total
Approximately 185 g protein, 165 g carbohydrates, 65 g fat and 21 g fibre


HIGH-DAY MENU

Meal 1
300 g zero-fat Greek yogurt
70 g dry oats
30 g whey protein
150 g berries
120 g banana
15 g natural peanut butter

Approximate macros:
72 g protein
109 g carbohydrates
15 g fat
12 g fibre


Meal 2
150 g cooked chicken breast
350 g cooked white or jasmine rice
150 g vegetables
15 g olive oil

Approximate macros:
59 g protein
109 g carbohydrates
22 g fat
7 g fibre


Meal 3
150 g cooked lean ground turkey
320 g cooked potatoes
150 g vegetables
10 g olive oil

Approximate macros:
50 g protein
78 g carbohydrates
23 g fat
8 g fibre


Daily Total
Approximately 181 g protein, 295 g carbohydrates, 60 g fat and 27 g fibre


FOOD-WEIGHING RULES
Chicken, turkey, rice, potatoes and vegetables are listed using their cooked weight.
Oats, whey protein, peanut butter and olive oil are measured as packaged.
Use the same weighing method every day. Do not weigh rice raw one day and cooked the next.
Every cooking oil, sauce, dressing, spread and beverage containing calories must be tracked.
Seasonings, mustard, hot sauce, zero-calorie drinks and low-calorie flavourings are permitted, provided they do not cause digestion problems or encourage uncontrolled snacking.`;

function parseMacroLine(line: string): { protein?: number; carbs?: number; fats?: number; fibre?: number } {
  const out: any = {};
  const p = line.match(/(\d+(?:\.\d+)?)\s*g?\s*protein/i);
  const c = line.match(/(\d+(?:\.\d+)?)\s*g?\s*(?:carb|carbohydrate)/i);
  const f = line.match(/(\d+(?:\.\d+)?)\s*g?\s*fat/i);
  const fb = line.match(/(\d+(?:\.\d+)?)\s*g?\s*fibre|fiber/i);
  if (p) out.protein = Number(p[1]);
  if (c) out.carbs = Number(c[1]);
  if (f) out.fats = Number(f[1]);
  if (fb) out.fibre = Number(fb[1]);
  return out;
}

function labelFromHeader(header: string): string {
  const h = header.toUpperCase();
  if (h.includes("NON-TRAINING") || h.includes("REST")) return "Non-Training Day";
  if (h.includes("TRAINING")) return "Training Day";
  if (h.includes("HIGH")) return "High Day";
  if (h.includes("LOW")) return "Low Day";
  if (h.includes("REFEED")) return "Refeed Day";
  // Strip the word MENU and titlecase the rest
  return header.replace(/MENU/i, "").trim().replace(/\b\w/g, (m) => m.toUpperCase()) || "Day";
}

/** The trailing FOOD-WEIGHING RULES block (heading included), or null. */
export function parseFoodWeighingRules(text: string): string | null {
  const lines = plainPastedText(text).split("\n");
  const start = lines.findIndex((l) => /^FOOD[- ]?WEIGHING\b/i.test(l.trim()));
  if (start < 0) return null;
  const body = lines.slice(start + 1).join("\n").trim();
  return body || null;
}

export function parseMealPlan(text: string): ParsedDay[] {
  if (!text.trim()) return [];
  const lines = plainPastedText(text).split("\n");
  // Find menu section indices
  const sections: { header: string; start: number }[] = [];
  lines.forEach((ln, i) => {
    const t = ln.trim();
    if (/MENU\s*$/i.test(t) && t.length < 80 && !/^meal/i.test(t)) {
      sections.push({ header: t, start: i });
    }
  });
  if (!sections.length) return [];
  const days: ParsedDay[] = [];
  sections.forEach((s, idx) => {
    const end = sections[idx + 1]?.start ?? lines.length;
    // Stop at FOOD-WEIGHING RULES or similar trailing rules block
    let stop = end;
    for (let i = s.start + 1; i < end; i++) {
      if (/^(FOOD[- ]?WEIGHING|RULES|NOTES)\b/i.test(lines[i].trim())) { stop = i; break; }
    }
    const body = lines.slice(s.start + 1, stop).join("\n").trim();
    // Find Daily Total macros
    const totalMatch = body.match(/Daily\s+Total[\s\S]*?(Approximately[^\n]+|\d[^\n]*protein[^\n]+)/i);
    let macros: any = {};
    if (totalMatch) {
      macros = parseMacroLine(totalMatch[1]);
    } else {
      // Sum each "Approximate macros" block
      const matches = [...body.matchAll(/Approximate macros?:?\s*\n([\s\S]*?)(?=\n\s*\n|$)/gi)];
      let p = 0, c = 0, f = 0, fb = 0, any = false;
      for (const m of matches) {
        const got = parseMacroLine(m[1].replace(/\n/g, " "));
        if (got.protein) { p += got.protein; any = true; }
        if (got.carbs) { c += got.carbs; any = true; }
        if (got.fats) { f += got.fats; any = true; }
        if (got.fibre) { fb += got.fibre; any = true; }
      }
      if (any) macros = { protein: p, carbs: c, fats: f, fibre: fb };
    }
    const calories = macros.protein != null && macros.carbs != null && macros.fats != null
      ? Math.round(macros.protein * 4 + macros.carbs * 4 + macros.fats * 9)
      : null;
    days.push({
      day_label: labelFromHeader(s.header),
      protein: macros.protein ?? null,
      carbs: macros.carbs ?? null,
      fats: macros.fats ?? null,
      fibre: macros.fibre ?? null,
      calories,
      notes: body,
      sort_order: idx,
    });
  });
  return days;
}

type Props = {
  onApply: (days: ParsedDay[], foodWeighingRules: string | null, phase: string | null) => void;
  /** The client the plan is for: their latest Nutrition Update fills the ChatGPT prompt. */
  clientId?: string | null;
  /** A phase the coach picked in the dialog (wins over the request's). */
  phase?: string | null;
};

type RequestsData = {
  requests: Array<{
    id: string;
    status: string;
    submitted_at: string | null;
    answers: QA[];
    plan: null | { status: string; targets_text: string | null; phase: string | null; workout_meals?: WorkoutMealsMode | null };
  }>;
  requestedAt: string | null;
  requestedPhase: string | null;
  requestedWorkoutMeals: WorkoutMealsMode | null;
  client: ClientBasics;
  trainingPattern: TrainingPattern | null;
};

function shortDate(iso: string | null | undefined) {
  return iso ? new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" }) : "";
}

export function MealPlanBulkPaste({ onApply, clientId, phase: coachPhase }: Props) {
  const [text, setText] = useState("");
  const [copied, setCopied] = useState<"template" | "prompt" | null>(null);
  const listFn = useServerFn(listNutritionRequestsFn);
  // Same query (and cache) as the client's Nutrition Update panel.
  const reqQ = useQuery({
    queryKey: ["nutrition-requests", clientId],
    enabled: !!clientId,
    queryFn: () => listFn({ data: { clientId: clientId! } }) as Promise<RequestsData>,
    staleTime: 60_000,
    retry: false,
  });

  // Built ahead of the tap, so copying never waits on the network (iOS only
  // lets a tap copy synchronously).
  const { prompt, source } = useMemo(() => {
    const data = reqQ.data;
    const latest = data ? currentRequest(data.requests ?? [], data.requestedAt ?? null) : null;
    const answered = latest && latest.status !== "in_progress" && latest.answers?.length ? latest : null;
    const targets = answered?.plan?.status === "ready" ? answered.plan.targets_text?.trim() || null : null;
    const phase = coachPhase || answered?.plan?.phase || data?.requestedPhase || null;
    const name = data?.client?.name?.trim().split(/\s+/)[0] || null;
    return {
      prompt: quickPastePrompt({
        client: data?.client ?? null,
        qas: answered?.answers ?? null,
        targetsText: targets,
        phase,
        workoutMeals: answered?.plan?.workout_meals ?? data?.requestedWorkoutMeals ?? null,
        history: data?.trainingPattern ?? null,
      }),
      source: !clientId
        ? null
        : reqQ.isLoading
          ? "Loading the client's Nutrition Update…"
          : !answered
            ? `No Nutrition Update from ${name ?? "this client"} yet, so the prompt's client details are blank to fill in.`
            : targets
              ? `Filled in from ${name ? `${name}'s` : "their"} Nutrition Update (${shortDate(answered.submitted_at)}) and the AI targets.`
              : `Filled in from ${name ? `${name}'s` : "their"} Nutrition Update (${shortDate(answered.submitted_at)}). Add your calorie and macro targets where it says (fill in).`,
    };
  }, [reqQ.data, reqQ.isLoading, clientId, coachPhase]);

  const copy = async (kind: "template" | "prompt") => {
    try {
      await navigator.clipboard.writeText(kind === "template" ? EXAMPLE_TEMPLATE : prompt);
      setCopied(kind);
      toast.success(kind === "template" ? "Template copied" : "ChatGPT prompt copied");
      setTimeout(() => setCopied(null), 1500);
    } catch {
      toast.error("Copy failed — long-press and copy manually");
    }
  };

  const pasteFromClipboard = async () => {
    try {
      const t = await navigator.clipboard.readText();
      if (t) setText(t);
    } catch {
      toast.error("Couldn't read clipboard — paste manually");
    }
  };

  const apply = () => {
    const parsed = parseMealPlan(text);
    if (!parsed.length) {
      toast.error("No menus found. Make sure each day starts with a header ending in 'MENU' (e.g. TRAINING-DAY MENU).");
      return;
    }
    const phase = phaseFromPlanText(text);
    onApply(parsed, parseFoodWeighingRules(text), phase);
    toast.success(`Imported ${parsed.length} day${parsed.length > 1 ? "s" : ""}${phase ? ` · phase: ${phase}` : ""}`);
  };

  const preview = text.trim() ? parseMealPlan(text) : [];

  return (
    <div className="space-y-3" data-meal-plan-paste>
      <p className="text-[13px] text-muted-foreground">
        Paste a plan from ChatGPT and it's split into days with their macros.
        {source ? <span className="block text-foreground/80">{source}</span> : null}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" className="h-10 gap-1.5" onClick={() => copy("prompt")}>
          {copied === "prompt" ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
          Copy ChatGPT prompt
        </Button>
        <Button type="button" variant="ghost" className="h-10 gap-1.5" onClick={() => copy("template")}>
          {copied === "template" ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
          Copy format example
        </Button>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <Label className="text-[13px] text-muted-foreground">The plan</Label>
          <Button type="button" variant="ghost" className="h-9 gap-1.5 px-2" onClick={pasteFromClipboard}>
            <ClipboardPaste className="h-4 w-4" /> Paste
          </Button>
        </div>
        <Textarea
          rows={8}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={`TRAINING-DAY MENU\n\nMeal 1\n300 g greek yogurt\n50 g oats\n...\n\nApproximate macros:\n67 g protein\n68 g carbohydrates\n13 g fat\n10 g fibre\n\n...\n\nDaily Total\nApproximately 185 g protein, 230 g carbohydrates, 60 g fat and 25 g fibre`}
          className="font-mono text-xs leading-relaxed"
          spellCheck={false}
        />
      </div>

      {preview.length > 0 && (
        <div className="divide-y divide-border rounded-xl border border-border">
          {preview.map((d, i) => (
            <div key={i} className="flex items-baseline justify-between gap-3 px-3 py-2">
              <span className="min-w-0 truncate text-sm font-medium">{d.day_label}</span>
              <span className="shrink-0 text-[13px] tabular-nums text-muted-foreground">
                {d.calories ?? "—"} kcal · P {d.protein ?? "—"} · C {d.carbs ?? "—"} · F {d.fats ?? "—"}
              </span>
            </div>
          ))}
        </div>
      )}

      <Button type="button" variant="outline" className="h-11 w-full gap-1.5" onClick={apply} disabled={!text.trim()}>
        <Wand2 className="h-4 w-4" />
        {preview.length ? `Use these ${preview.length} day${preview.length > 1 ? "s" : ""}` : "Fill the days from it"}
      </Button>
    </div>
  );
}