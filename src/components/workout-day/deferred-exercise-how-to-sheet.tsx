import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { useExerciseVideoSetGlobal } from "@/hooks/use-exercise-video-set";
import { exerciseGuideKey, fetchExerciseGuide, guideVideoUrl } from "@/lib/exercise-guide";
import { ExerciseDemoVideo } from "@/components/exercise-demo-video";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

export default function DeferredExerciseHowToSheet({
  exerciseId,
  fallbackName,
  onClose,
}: {
  exerciseId: string | null;
  fallbackName: string;
  onClose: () => void;
}) {
  // Usually already in the cache: the How To button starts this on touch-down.
  const { data: exercise = null, isLoading } = useQuery({
    queryKey: exerciseGuideKey(exerciseId, fallbackName),
    queryFn: () => fetchExerciseGuide(exerciseId, fallbackName),
    staleTime: 10 * 60_000,
  });
  const { data: globalSet } = useExerciseVideoSetGlobal();
  const ownUrl = guideVideoUrl(exercise, globalSet ?? null);
  // Not uploaded yet: the closest exercise's demo, labelled as such.
  const borrowedUrl = !ownUrl && exercise?.borrowed ? guideVideoUrl(exercise.borrowed, globalSet ?? null) : null;
  const videoUrl = ownUrl ?? borrowedUrl;
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
        className="h-[92vh] overflow-y-auto p-0 [&>button]:hidden sm:mx-auto sm:max-w-xl sm:rounded-t-2xl"
      >
        <SheetHeader className="sticky top-0 z-10 border-b bg-background/95 px-5 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] text-left backdrop-blur">
          <div className="flex items-center gap-3">
            <Button variant="outline" size="sm" className="h-9 shrink-0 rounded-full px-3" onClick={onClose}>
              <ArrowLeft className="mr-1 h-4 w-4" /> Back
            </Button>
            <SheetTitle className="min-w-0 truncate text-base font-black">{name}</SheetTitle>
          </div>
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
          ) : videoUrl ? (
            <div className="space-y-1.5">
              <ExerciseDemoVideo url={videoUrl} title={`${name} video`} />
              {borrowedUrl && exercise?.borrowed && (
                <p data-borrowed-demo className="text-[12px] leading-snug text-muted-foreground">
                  Showing the <span className="font-semibold text-foreground">{exercise.borrowed.name}</span> demo: same movement. This exercise's own video is on its way.
                </p>
              )}
            </div>
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
