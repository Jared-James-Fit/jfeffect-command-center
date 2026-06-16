import { Link } from "@tanstack/react-router";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Eye, PlusCircle, Loader2, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ProgramFacets } from "@/lib/programs/facets";
import { facetChips } from "@/lib/programs/facets";

export interface ProgramCardProps {
  id: string;
  title: string;
  description?: string | null;
  facets: ProgramFacets;
  featured?: boolean;
  /** Optional Top-Picks match reasons rendered as a thin reason strip. */
  reasons?: string[];
  /** Disabled when the program can't be enrolled by this viewer. */
  disabled?: boolean;
  pending?: boolean;
  previewTo: { to: string; params?: Record<string, string> };
  onAdd?: () => void;
  addLabel?: string;
}

export function ProgramCard({
  title,
  description,
  facets,
  featured,
  reasons,
  disabled,
  pending,
  previewTo,
  onAdd,
  addLabel = "Add to My Training",
}: ProgramCardProps) {
  const chips = facetChips(facets);
  return (
    <Card className={cn(
      "flex flex-col overflow-hidden p-4",
      reasons && reasons.length > 0 && "border-primary/40 ring-1 ring-primary/10",
    )}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="line-clamp-2 break-words text-base font-semibold leading-snug">{title}</h3>
        </div>
        {featured && <Badge variant="secondary" className="shrink-0">Featured</Badge>}
      </div>

      {reasons && reasons.length > 0 && (
        <div className="mt-2 flex items-start gap-1.5 text-xs text-primary">
          <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="line-clamp-2">{reasons.join(" · ")}</span>
        </div>
      )}

      {chips.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {chips.slice(0, 5).map((c: string) => (
            <Badge key={c} variant="outline" className="text-[10px] font-normal">{c}</Badge>
          ))}
        </div>
      )}

      {description && (
        <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">{description}</p>
      )}

      <div className="mt-auto flex gap-2 pt-3">
        <Link to={previewTo.to as any} params={previewTo.params as any} className="flex-1">
          <Button variant="outline" size="sm" className="w-full">
            <Eye className="mr-1 h-3.5 w-3.5" /> Preview
          </Button>
        </Link>
        <Button size="sm" className="flex-1" disabled={disabled || pending} onClick={onAdd}>
          {pending ? (
            <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
          ) : (
            <PlusCircle className="mr-1 h-3.5 w-3.5" />
          )}
          {addLabel}
        </Button>
      </div>
    </Card>
  );
}
