import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { getExerciseVideoSource } from "@/lib/exercise-video";
import { useExerciseVideoSetGlobal } from "@/hooks/use-exercise-video-set";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

const GUIDE_COLUMNS =
  "id,name,video_url,vimeo_embed_url,secondary_vimeo_embed_url,youtube_url,active_video_set,cues,common_mistakes,muscle_group,category";

type ExerciseGuide = {
  id: string;
  name: string | null;
  video_url: string | null;
  vimeo_embed_url: string | null;
  secondary_vimeo_embed_url: string | null;
  youtube_url: string | null;
  active_video_set: string | null;
  cues: string | string[] | null;
  common_mistakes: string | string[] | null;
  muscle_group: string | null;
  category: string | null;
};

export default function DeferredExerciseHowToSheet({
  exerciseId,
  fallbackName,
  onClose,
}: {
  exerciseId: string | null;
  fallbackName: string;
  onClose: () => void;
}) {
  const { data: exercise = null, isLoading } = useQuery({
    queryKey: ["workout-exercise-guide", exerciseId ?? fallbackName],
    queryFn: async () => {
      const query = supabase.from("exercises").select(GUIDE_COLUMNS);
      const { data, error } = exerciseId
        ? await query.eq("id", exerciseId).maybeSingle()
        : await query.eq("name", fallbackName).maybeSingle();
      if (error) throw error;
      return data as unknown as ExerciseGuide | null;
    },
    staleTime: 10 * 60_000,
  });
  const { data: globalSet } = useExerciseVideoSetGlobal();
  const videoSrc = exercise
    ? getExerciseVideoSource(exercise, { globalOverride: globalSet ?? null })
    : null;
  const directVideo =
    exercise?.video_url ?? exercise?.vimeo_embed_url ?? exercise?.youtube_url ?? null;
  const hasPrimary = videoSrc && videoSrc.status !== "coming_soon" && !!videoSrc.url;
  const name = exercise?.name ?? fallbackName;
  const cues = exercise?.cues ?? null;
  const mistakes = exercise?.common_mistakes ?? null;
  const muscles = exercise?.muscle_group ?? null;
  const category = exercise?.category ?? null;

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent
        side="bottom"
        className="h-[92vh] overflow-y-auto p-0 sm:mx-auto sm:max-w-xl sm:rounded-t-2xl"
      >
        <SheetHeader className="sticky top-0 z-10 border-b bg-background/95 px-5 py-3 text-left backdrop-blur">
          <SheetTitle className="text-base font-black">{name}</SheetTitle>
          {(category || muscles) && (
            <SheetDescription className="text-xs">
              {[category, muscles].filter(Boolean).join(" · ")}
            </SheetDescription>
          )}
        </SheetHeader>
        <div className="space-y-4 px-5 py-4 pb-32">
          {isLoading ? (
            <div
              className="aspect-video animate-pulse rounded-xl border bg-muted"
              aria-label="Loading exercise guide"
            />
          ) : hasPrimary ? (
            <iframe
              src={videoSrc!.url!}
              title={`${name} video`}
              allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
              allowFullScreen
              className="aspect-video w-full rounded-xl border bg-black"
            />
          ) : directVideo ? (
            <iframe
              src={toEmbedUrl(directVideo)}
              title={`${name} video`}
              allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
              allowFullScreen
              className="aspect-video w-full rounded-xl border bg-black"
            />
          ) : (
            <div className="grid aspect-video w-full place-items-center rounded-xl border border-dashed bg-black/40 text-sm text-muted-foreground">
              Video coming soon.
            </div>
          )}
          {cues && <GuideText title="Coaching cues" value={cues} />}
          {mistakes && <GuideText title="Common mistakes" value={mistakes} />}
          {muscles && <GuideText title="Muscles worked" value={muscles} />}
        </div>
        <div className="sticky bottom-0 left-0 right-0 border-t bg-background/95 px-5 py-3 backdrop-blur">
          <Button className="w-full" size="lg" onClick={onClose}>
            <ArrowLeft className="mr-2 h-4 w-4" /> Back to Workout
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function GuideText({ title, value }: { title: string; value: string | string[] }) {
  return (
    <section>
      <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">{title}</h3>
      <p className="mt-1 whitespace-pre-wrap text-sm">
        {Array.isArray(value) ? value.join("\n• ") : value}
      </p>
    </section>
  );
}

function toEmbedUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.includes("youtube.com") && parsed.pathname === "/watch") {
      const id = parsed.searchParams.get("v");
      if (id) return `https://www.youtube.com/embed/${id}?playsinline=1`;
    }
    if (parsed.hostname === "youtu.be") {
      const id = parsed.pathname.replace("/", "");
      if (id) return `https://www.youtube.com/embed/${id}?playsinline=1`;
    }
    if (parsed.hostname.includes("vimeo.com") && !parsed.hostname.includes("player.")) {
      const id = parsed.pathname.replace("/", "");
      if (id) return `https://player.vimeo.com/video/${id}`;
    }
  } catch {
    return url;
  }
  return url;
}
