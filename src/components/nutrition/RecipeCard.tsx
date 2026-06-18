import { Link } from "@tanstack/react-router";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Flame, Beef, Clock, Users } from "lucide-react";
import type { Recipe } from "@/lib/recipes";
import { getRecipeMeta } from "@/lib/recipe-meta";

export function RecipeCard({
  recipe,
  to,
  isNew,
}: {
  recipe: Recipe;
  to: { pathname: string; params: Record<string, string> };
  isNew?: boolean;
}) {
  const meta = getRecipeMeta(recipe.body);
  const tags = (recipe.tags ?? []).slice(0, 3);

  return (
    <Link to={to.pathname as any} params={to.params as any}>
      <Card className="group flex h-full flex-col gap-3 overflow-hidden p-4 transition-colors hover:border-primary/40 hover:bg-muted/30">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="text-base font-bold leading-snug">{recipe.title}</div>
            <Badge variant="outline" className="mt-1 text-[10px]">{recipe.category}</Badge>
          </div>
          {isNew && (
            <Badge className="shrink-0 bg-primary text-[10px] text-primary-foreground">New</Badge>
          )}
        </div>

        <div className="grid grid-cols-4 gap-2 rounded-lg border border-border/60 bg-secondary/30 p-2">
          <Stat icon={Flame} label="kcal" value={meta.calories} />
          <Stat icon={Beef} label="P (g)" value={meta.protein} />
          <Stat icon={Clock} label="min" value={meta.prepMinutes} />
          <Stat icon={Users} label="serv" value={meta.servings} />
        </div>

        {tags.length > 0 && (
          <div className="mt-auto flex flex-wrap gap-1">
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
