import { Suspense, useMemo, useState } from "react";
import { lazyWithRetry } from "@/lib/lazy-chunk";
import { sessionDisplayTitle } from "@/lib/community";
import { ShareStudio } from "@/components/community/share-studio";
import { CameraChip } from "@/components/community/camera-overlays";
import { useWorkoutStudio, type StudioWorkout } from "@/components/community/use-workout-studio";

const ShareComposer = lazyWithRetry(() => import("@/components/community/share-composer").then((m) => ({ default: m.ShareComposer })));

/**
 * The studio for one workout you just finished (the recap's Share): camera
 * first with its looks, snap, Post or Story. A video from the library opens
 * the full editor instead (cards can't sit on video).
 */
export function WorkoutShareStudio({
  open,
  onClose,
  completionId,
  athleteName,
  workoutTitle,
  unit,
}: {
  open: boolean;
  onClose: () => void;
  completionId: string;
  athleteName?: string | null;
  workoutTitle?: string | null;
  unit: "kg" | "lb";
}) {
  const target = useMemo<StudioWorkout>(() => ({ completion_id: completionId, title: workoutTitle || "Workout", athlete_name: athleteName ?? null }), [completionId, workoutTitle, athleteName]);
  const w = useWorkoutStudio(target, unit, open);
  const [video, setVideo] = useState<File | null>(null);
  return (
    <>
      <ShareStudio
        open={open && !video}
        onClose={onClose}
        accept="image/*,video/*"
        onVideo={setVideo}
        canShoot={w.ready}
        card={w.card}
        post={w.post}
        chip={<CameraChip icon="🔥" title={sessionDisplayTitle(target.title)} sub={w.ready ? "Swipe for more looks" : "Getting your numbers…"} />}
      />
      {video && (
        <Suspense fallback={null}>
          <ShareComposer
            open={!!video}
            onOpenChange={(o) => {
              if (!o) {
                setVideo(null);
                onClose();
              }
            }}
            completionId={completionId}
            athleteName={athleteName}
            workoutTitle={workoutTitle}
            unit={unit}
            initialFile={video}
          />
        </Suspense>
      )}
    </>
  );
}
