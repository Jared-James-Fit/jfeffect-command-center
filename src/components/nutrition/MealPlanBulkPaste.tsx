import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Copy, ClipboardPaste, Sparkles, Check, Wand2 } from "lucide-react";
import { toast } from "sonner";

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

const EXAMPLE_TEMPLATE = `TRAINING-DAY MENU

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

const CHATGPT_PROMPT = `You are a nutrition coach. Build a full meal plan using the EXACT format below so it can be pasted directly into the JF Effect coaching app.

CLIENT DETAILS (fill in):
- Bodyweight:
- Training days per week:
- Daily calorie target:
- Daily protein / carbs / fat / fibre targets:
- Allergies / dislikes:
- Preferred foods:

FORMAT RULES (strict — do not change headings, do not add extra commentary):
1. Create one menu per day-type the client needs (e.g. TRAINING-DAY MENU, NON-TRAINING-DAY MENU, HIGH-DAY MENU). Each menu header ends with the word MENU in ALL CAPS.
2. Inside each menu, list "Meal 1", "Meal 2", "Meal 3"… on their own line.
3. Under each meal, list every food on its own line as: "<amount> g <food>" (use cooked weight for meat, rice, potatoes, vegetables; packaged weight for oats, whey, peanut butter, oils).
4. After each meal add a blank line, then:
   Approximate macros:
   <P> g protein
   <C> g carbohydrates
   <F> g fat
   <Fb> g fibre
5. End every menu with:
   Daily Total
   Approximately <P> g protein, <C> g carbohydrates, <F> g fat and <Fb> g fibre
6. After all menus, include a FOOD-WEIGHING RULES section with the standard rules (cooked vs packaged, weigh consistently, track all calorie beverages, seasonings/zero-cal drinks allowed).

Output plain text only — no markdown, no bullets, no tables. Match the formatting exactly so the app's parser can read it.`;

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

export function parseMealPlan(text: string): ParsedDay[] {
  if (!text.trim()) return [];
  const lines = text.replace(/\r\n/g, "\n").split("\n");
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
      calories,
      notes: body,
      sort_order: idx,
    });
  });
  return days;
}

type Props = {
  onApply: (days: ParsedDay[]) => void;
};

export function MealPlanBulkPaste({ onApply }: Props) {
  const [text, setText] = useState("");
  const [copied, setCopied] = useState<"template" | "prompt" | null>(null);

  const copy = async (kind: "template" | "prompt") => {
    try {
      await navigator.clipboard.writeText(kind === "template" ? EXAMPLE_TEMPLATE : CHATGPT_PROMPT);
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
    onApply(parsed);
    toast.success(`Imported ${parsed.length} day${parsed.length > 1 ? "s" : ""}`);
  };

  const preview = text.trim() ? parseMealPlan(text) : [];

  return (
    <div className="rounded-lg border-2 border-dashed border-primary/40 bg-primary/5 p-4 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <div>
            <div className="text-sm font-bold uppercase tracking-wide">Quick paste meal plan</div>
            <div className="text-[11px] text-muted-foreground">Paste a full plan and we'll auto-split it into days with macros.</div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" className="gap-1" onClick={() => copy("prompt")}>
            {copied === "prompt" ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
            Copy ChatGPT prompt
          </Button>
          <Button type="button" size="sm" variant="outline" className="gap-1" onClick={() => copy("template")}>
            {copied === "template" ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
            Copy format example
          </Button>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label className="text-[11px] uppercase tracking-widest text-muted-foreground">Paste full plan here</Label>
        <Textarea
          rows={10}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={`TRAINING-DAY MENU\n\nMeal 1\n300 g greek yogurt\n50 g oats\n...\n\nApproximate macros:\n67 g protein\n68 g carbohydrates\n13 g fat\n\n...\n\nDaily Total\nApproximately 185 g protein, 230 g carbohydrates and 60 g fat`}
          className="font-mono text-xs leading-relaxed"
          spellCheck={false}
        />
      </div>

      {preview.length > 0 && (
        <div className="rounded-md border border-border bg-card p-3 space-y-1.5">
          <div className="text-[11px] uppercase tracking-widest text-muted-foreground">Preview ({preview.length} day{preview.length > 1 ? "s" : ""})</div>
          <ul className="space-y-1 text-xs">
            {preview.map((d, i) => (
              <li key={i} className="flex flex-wrap items-center justify-between gap-2 rounded border border-border/60 bg-secondary/30 px-2 py-1">
                <span className="font-semibold">{d.day_label}</span>
                <span className="text-muted-foreground">
                  {d.calories ?? "—"} kcal · P {d.protein ?? "—"} / C {d.carbs ?? "—"} / F {d.fats ?? "—"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" className="gap-1" onClick={pasteFromClipboard}>
          <ClipboardPaste className="h-3.5 w-3.5" /> Paste from clipboard
        </Button>
        <Button type="button" size="sm" className="bg-gradient-primary font-bold uppercase gap-1" onClick={apply} disabled={!text.trim()}>
          <Wand2 className="h-3.5 w-3.5" /> Import into day targets
        </Button>
      </div>
    </div>
  );
}