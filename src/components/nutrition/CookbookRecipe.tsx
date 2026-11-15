/**
 * One recipe, read top to bottom: what it is and how long, its numbers per
 * serving, "Log this meal" (one serving into today's food log), ingredients,
 * steps, how to make it fit a cut or a bulk, tips, and the recipe disclaimer.
 * Shown inside the Cookbook sheet and on a recipe's own page (a shared link).
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ChevronDown, Clock, Loader2, Plus, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { getEmbedUrl } from "@/lib/recipe-format";
import { canLogEntry, type CookbookEntry } from "@/lib/cookbook/view";
import { RECIPE_DISCLAIMER, RECIPE_DISCLAIMER_SHORT } from "@/lib/nutrition-disclaimer";
import { useLogFood } from "./food-log-context";
import { MACRO_COLOR } from "./macro-palette";

export function CookbookRecipeView({ entry, canLog = true }: { entry: CookbookEntry; canLog?: boolean }) {
  const logFood = useLogFood();
  const [logging, setLogging] = useState(false);
  const loggable = canLog && canLogEntry(entry);
  const facts = [
    entry.method,
    entry.prepMinutes != null ? `${entry.prepMinutes} min hands-on` : null,
    entry.cookNote,
    entry.servings > 1 ? `Makes ${entry.servings} servings` : null,
  ].filter(Boolean) as string[];
  const embed = getEmbedUrl(entry.videoUrl);

  return (
    <article className="space-y-5" data-cookbook-recipe>
      <header className="space-y-1.5">
        <h2 className="text-xl font-semibold leading-tight">{entry.title}</h2>
        {facts.length > 0 && (
          <p className="flex flex-wrap items-center gap-x-1.5 text-sm text-muted-foreground">
            <Clock className="h-3.5 w-3.5 shrink-0" aria-hidden />
            {facts.join(" · ")}
          </p>
        )}
      </header>

      {(entry.calories != null || entry.protein != null) && (
        <div>
          <div className="grid grid-cols-4 gap-2" data-recipe-macros>
            <Stat label="Calories" value={entry.calories} unit="" />
            <Stat label="Protein" value={entry.protein} unit="g" color={MACRO_COLOR.protein} />
            <Stat label="Carbs" value={entry.carbs} unit="g" color={MACRO_COLOR.carbs} />
            <Stat label="Fat" value={entry.fat} unit="g" color={MACRO_COLOR.fats} />
          </div>
          <p className="mt-1.5 text-xs text-muted-foreground">{RECIPE_DISCLAIMER_SHORT}</p>
        </div>
      )}

      {loggable && (
        <Button
          className="h-11 w-full"
          disabled={logging}
          onClick={async () => {
            setLogging(true);
            await logFood({
              name: entry.title,
              calories: Math.round(entry.calories ?? 0),
              protein_g: entry.protein ?? 0,
              carbs_g: entry.carbs ?? 0,
              fat_g: entry.fat ?? 0,
              source: "preset",
              raw_text: "From the Cookbook",
            });
            setLogging(false);
          }}
        >
          {logging ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          Log a serving
        </Button>
      )}

      {entry.ingredients.length > 0 && (
        <section>
          <h3 className="mb-2 text-base font-semibold">Ingredients</h3>
          <ul className="space-y-1.5 text-[15px] leading-snug">
            {entry.ingredients.map((item, i) => (
              <li key={i} className="flex gap-2.5">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/60" aria-hidden />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {entry.steps.length > 0 && (
        <section>
          <h3 className="mb-2 text-base font-semibold">Steps</h3>
          <ol className="space-y-3 text-[15px] leading-snug">
            {entry.steps.map((step, i) => (
              <li key={i} className="flex gap-3">
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-muted text-xs font-semibold tabular-nums">
                  {i + 1}
                </span>
                <span className="pt-0.5">{step}</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      {(entry.cutting || entry.bulking) && (
        <section className="rounded-xl border border-border p-3" data-recipe-goals>
          <h3 className="mb-2 text-sm font-semibold">Make it fit your goal</h3>
          <dl className="space-y-2 text-sm leading-snug">
            {entry.cutting && (
              <div>
                <dt className="font-semibold">Cutting</dt>
                <dd className="text-muted-foreground">{entry.cutting}</dd>
              </div>
            )}
            {entry.bulking && (
              <div>
                <dt className="font-semibold">Bulking</dt>
                <dd className="text-muted-foreground">{entry.bulking}</dd>
              </div>
            )}
          </dl>
        </section>
      )}

      {(entry.tips.length > 0 || entry.notes.length > 0) && (
        <section>
          <h3 className="mb-1.5 text-sm font-semibold">Tips</h3>
          <ul className="space-y-1.5 text-sm leading-snug text-muted-foreground">
            {[...entry.tips, ...entry.notes].map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
        </section>
      )}

      {entry.videoUrl && (
        <div className="overflow-hidden rounded-xl border border-border">
          {embed ? (
            <div className="aspect-video w-full">
              <iframe src={embed} className="h-full w-full" allow="encrypted-media; picture-in-picture" allowFullScreen title={`${entry.title}: video`} />
            </div>
          ) : (
            <a href={entry.videoUrl} target="_blank" rel="noreferrer" className="block p-3 text-sm font-semibold underline">
              Watch the video
            </a>
          )}
        </div>
      )}

      <RecipeDisclaimer />
    </article>
  );
}

function Stat({ label, value, unit, color }: { label: string; value: number | null; unit: string; color?: string }) {
  return (
    <div className="rounded-xl bg-muted px-2 py-2.5 text-center">
      <div className="text-lg font-semibold leading-none tabular-nums">
        {value != null ? Math.round(value).toLocaleString("en-CA") : "—"}
        {value != null && unit && <span className="text-xs font-normal text-muted-foreground"> {unit}</span>}
      </div>
      <div className="mt-1 flex items-center justify-center gap-1 text-[11px] text-muted-foreground">
        {color && <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} aria-hidden />}
        {label}
      </div>
    </div>
  );
}

/**
 * The recipe disclaimer: one quiet line that opens in place to the full text
 * (estimates, labels and allergens, food safety, not medical advice).
 */
export function RecipeDisclaimer({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={cn("rounded-xl border border-border", className)} data-recipe-disclaimer>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex min-h-11 w-full items-center gap-2 px-3 py-2 text-left text-xs text-muted-foreground"
      >
        <ShieldAlert className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span className="flex-1">Estimates, allergens and food safety</span>
        <ChevronDown className={cn("h-4 w-4 shrink-0 transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      {open && (
        <div className="space-y-2 border-t border-border px-3 py-3 text-xs leading-relaxed text-muted-foreground">
          {RECIPE_DISCLAIMER.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </div>
      )}
    </div>
  );
}
