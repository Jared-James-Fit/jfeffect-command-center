import { Link } from "@tanstack/react-router";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Flame, Beef, Clock, Users } from "lucide-react";
import type { Recipe } from "@/lib/recipes";
import { getRecipeCardMeta } from "@/lib/recipe-meta";

const CATEGORY_ACCENT: Record<string, string> = {
  Breakfast: "from-amber-500/30 to-amber-500/0",
  Lunch: "from-emerald-500/30 to-emerald-500/0",
  Dinner: "from-indigo-500/30 to-indigo-500/0",
  Snack: "from-pink-500/30 to-pink-500/0",
  "Meal Prep": "from-sky-500/30 to-sky-500/0",
};

export function RecipeCard({
  recipe,
  to,
  isNew,
}: {
  recipe: Recipe;
  to: { pathname: string; params: Record<string, string> };
  isNew?: boolean;
}) {
  const meta = getRecipeCardMeta(recipe);
  const tags = (recipe.tags ?? []).slice(0, 3);
  const accent = CATEGORY_ACCENT[recipe.category] ?? "from-primary/30 to-primary/0";

  return (
    <Link to={to.pathname as any} params={to.params as any}>
      <Card className="group relative flex h-full flex-col gap-3 overflow-hidden p-4 transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md">
        {recipe.image_url ? (
          <div className="relative -mx-4 -mt-4 mb-1 aspect-[16/9] overflow-hidden bg-secondary">
            <img loading="lazy"
              src={recipe.image_url}
              alt={recipe.title}
              loading="lazy"
              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
            />
          </div>
        ) : (
          <div className={`pointer-events-none absolute inset-x-0 top-0 h-16 bg-gradient-to-b ${accent}`} aria-hidden />
        )}
        <div className="relative flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="text-base font-bold leading-snug">{recipe.title}</div>
            <Badge variant="outline" className="mt-1 text-[10px]">{recipe.category}</Badge>
          </div>
          {isNew && (
            <Badge className="shrink-0 bg-primary text-[10px] text-primary-foreground">New</Badge>
          )}
        </div>

        <div className="relative grid grid-cols-4 gap-2 rounded-lg border border-border/60 bg-secondary/40 p-2">
          <Stat icon={Flame} label="kcal" value={meta.calories} />
          <Stat icon={Beef} label="P (g)" value={meta.protein} />
          <Stat icon={Clock} label="min" value={meta.prepMinutes} />
          <Stat icon={Users} label="serv" value={meta.servings} />
        </div>

        {tags.length > 0 && (
          <div className="relative mt-auto flex flex-wrap gap-1">
            {tags.map((t) => (
              <Badge key={t} variant="secondary" className="text-[10px]">{t}</Badge>
            ))}
          </div>
        )}
      </Card>
    </Link>
  );
}

function Stat({ icon: Icon, label, value }: { icon: any; label: string; value: number | null }) {
  return (
    <div className="flex flex-col items-center justify-center text-center">
      <Icon className="h-3.5 w-3.5 text-muted-foreground" />
      <div className="text-sm font-bold leading-tight">{value ?? "—"}</div>
      <div className="text-[9px] uppercase tracking-wide text-muted-foreground">{label}</div>
    </div>
  );
}
