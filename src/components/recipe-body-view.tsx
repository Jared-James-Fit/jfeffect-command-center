import { parseRecipeBody, getEmbedUrl } from "@/lib/recipe-format";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ExternalLink } from "lucide-react";

export function RecipeBodyView({ body, videoUrl }: { body: string; videoUrl?: string | null }) {
  const parsed = parseRecipeBody(body);
  const finalVideo = videoUrl || parsed.videoUrl || null;
  const embed = getEmbedUrl(finalVideo);

  if (!parsed.sections.length && !finalVideo) {
    return <p className="text-sm text-muted-foreground">No recipe content yet.</p>;
  }

  return (
    <div className="space-y-5">
      {parsed.sections.map((s, i) => {
        if (s.kind === "field") {
          if (s.label === "Video Demo Link" || s.label === "Recipe Title") return null;
          return (
            <div key={i} className="flex flex-wrap items-baseline gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {s.label}
              </span>
              <span className="text-sm font-medium">{s.value}</span>
            </div>
          );
        }
        if (s.kind === "list") {
          const ListTag = s.ordered ? "ol" : "ul";
          return (
            <div key={i} className="space-y-2">
              <h3 className="text-sm font-bold uppercase tracking-wide text-primary">{s.label}</h3>
              <ListTag className={s.ordered ? "ml-5 list-decimal space-y-1.5 text-sm leading-relaxed" : "ml-5 list-disc space-y-1.5 text-sm leading-relaxed"}>
                {s.items.map((item, idx) => (
                  <li key={idx}>{item}</li>
                ))}
              </ListTag>
            </div>
          );
        }
        if (s.kind === "macros") {
          return (
            <div key={i} className="space-y-2">
              <h3 className="text-sm font-bold uppercase tracking-wide text-primary">{s.label}</h3>
              <div className="flex flex-wrap gap-2">
                {s.macros.map((m) => (
                  <Badge key={m.key} variant="outline" className="px-3 py-1.5 text-xs">
                    <span className="font-bold">{m.key}:</span>
                    <span className="ml-1">{m.value}</span>
                  </Badge>
                ))}
              </div>
            </div>
          );
        }
        return (
          <div key={i} className="space-y-1">
            {s.label && (
              <h3 className="text-sm font-bold uppercase tracking-wide text-primary">{s.label}</h3>
            )}
            <p className="whitespace-pre-wrap text-sm leading-relaxed">{s.text}</p>
          </div>
        );
      })}

      {finalVideo && (
        <Card className="overflow-hidden border-border/50">
          {embed ? (
            <div className="aspect-video w-full">
              <iframe
                src={embed}
                className="h-full w-full"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                title="Recipe demo"
              />
            </div>
          ) : (
            <a
              href={finalVideo}
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-between gap-3 p-4 text-sm font-bold hover:bg-muted/40"
            >
              <span>Watch Demo</span>
              <ExternalLink className="h-4 w-4" />
            </a>
          )}
        </Card>
      )}
    </div>
  );
}