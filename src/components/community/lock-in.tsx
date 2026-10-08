import { Suspense, useRef, useState } from "react";
import { Camera, Check, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { lazyWithRetry } from "@/lib/lazy-chunk";
import { cn } from "@/lib/utils";
import { PREVIEW_ONLY_MESSAGE, lockInTimeLabel } from "@/lib/community";
import { useCommunityActivity, useMyPostForCompletion } from "@/lib/community.queries";

const LockInEditor = lazyWithRetry(() => import("@/components/community/lock-in-editor").then((m) => ({ default: m.LockInEditor })));

export type LockInPick = { file: File; live: boolean; n: number };

const LOCK_GRADIENT = "bg-[linear-gradient(135deg,#ef3340_0%,#dd2a7b_60%,#8134af_100%)]";

/**
 * "Lock in" at the top of today's workout: one tap opens the camera, the
 * photo becomes a LOCKED IN card, one more tap posts it. Locking in starts
 * the session (same path as logging the first set), and the post is the
 * session's post: when they finish, it fills in with the real numbers.
 *
 * Light on purpose — the editor (canvas, upload) only loads once tapped, so
 * the logger stays as fast as it was.
 */
export function LockInBar({
  completionId,
  ensureStarted,
  workoutTitle,
  athleteName,
  previewOnly = false,
}: {
  /** Coach viewing as a client: looks the same, but never posts as them. */
  previewOnly?: boolean;
  /** The session's pl_day_completions.id once one exists. */
  completionId: string | null;
  /** Starts the session (idempotent) and returns its completion id. */
  ensureStarted: () => Promise<string | null>;
  workoutTitle: string;
  athleteName: string | null;
}) {
  const { data: activity } = useCommunityActivity(true);
  const { data: existing } = useMyPostForCompletion(completionId, !!completionId);
  const [open, setOpen] = useState(false);
  const [pick, setPick] = useState<LockInPick | null>(null);
  const camRef = useRef<HTMLInputElement | null>(null);
  const libRef = useRef<HTMLInputElement | null>(null);
  const seq = useRef(0);

  if (!activity?.enabled) return null;

  const done = !!existing;
  const time = lockInTimeLabel(existing?.locked_in_at);

  const onFile = (e: React.ChangeEvent<HTMLInputElement>, live: boolean) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) setPick({ file, live, n: ++seq.current });
  };

  // The camera has to open inside the tap itself (iOS), so it's clicked
  // here and the editor opens behind it. Cancel the camera → the editor is
  // still there with Library and "post without a photo".
  const start = () => {
    if (previewOnly) return void toast.message(PREVIEW_ONLY_MESSAGE);
    if (!done) camRef.current?.click();
    setOpen(true);
  };

  return (
    <>
      <input ref={camRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => onFile(e, true)} />
      <input ref={libRef} type="file" accept="image/*" className="hidden" onChange={(e) => onFile(e, false)} />

      {done ? (
        <button type="button" onClick={() => (previewOnly ? void toast.message(PREVIEW_ONLY_MESSAGE) : setOpen(true))} className="flex w-full items-center gap-3 rounded-2xl border border-border/70 bg-card px-3 py-2.5 text-left active:scale-[0.99]">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
            <Check className="h-4 w-4" strokeWidth={3} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] font-black">{existing?.locked_in_at ? `Locked in${time ? ` · ${time}` : ""}` : "Posted"}</span>
            <span className="block truncate text-[11px] text-muted-foreground">{existing?.visibility === "private" ? "Only you can see it" : existing?.visibility === "coach" ? "Only your coach sees it" : "Your numbers land on it when you finish"}</span>
          </span>
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        </button>
      ) : (
        <button type="button" onClick={start} className="flex w-full items-center gap-3 rounded-2xl border border-border/70 bg-card px-3 py-2.5 text-left active:scale-[0.99]">
          <span className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-full text-white shadow-md shadow-rose-500/20", LOCK_GRADIENT)}>
            <Camera className="h-5 w-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[14px] font-black leading-tight">Lock in</span>
            <span className="block truncate text-[12px] text-muted-foreground">Show the crew you showed up</span>
          </span>
          <span className={cn("shrink-0 rounded-full px-3 py-1.5 text-[12px] font-black text-white", LOCK_GRADIENT)}>📸 Snap</span>
        </button>
      )}

      {open && (
        <Suspense fallback={null}>
          <LockInEditor
            open={open}
            onOpenChange={(o) => {
              setOpen(o);
              if (!o) setPick(null);
            }}
            completionId={completionId}
            ensureStarted={ensureStarted}
            workoutTitle={workoutTitle}
            athleteName={athleteName}
            existing={existing ?? null}
            pick={pick}
            onCamera={() => camRef.current?.click()}
            onLibrary={() => libRef.current?.click()}
          />
        </Suspense>
      )}
    </>
  );
}
