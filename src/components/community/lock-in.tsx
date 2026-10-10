import { Suspense, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Camera, Check, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { lazyWithRetry } from "@/lib/lazy-chunk";
import { cn } from "@/lib/utils";
import { PREVIEW_ONLY_MESSAGE, lockInCameraCard, lockInTimeLabel } from "@/lib/community";
import { shareToCommunity, useCommunityActivity, useDayPlan, useMyPostForCompletion, usePublicSessionTitle } from "@/lib/community.queries";
import { useAuth } from "@/lib/auth";
import { CameraChip } from "@/components/community/camera-overlays";
import type { LockTemplate } from "@/components/community/lock-in-editor";

const LockInEditor = lazyWithRetry(() => import("@/components/community/lock-in-editor").then((m) => ({ default: m.LockInEditor })));
const ShareStudio = lazyWithRetry(() => import("@/components/community/share-studio").then((m) => ({ default: m.ShareStudio })));

export type LockInPick = { file: File; live: boolean; n: number };

const LOCK_GRADIENT = "bg-primary";

/**
 * "Lock in" at the top of today's workout: one tap opens the share studio
 * (the camera, already showing the LOCKED IN card), snap, add text or
 * stickers if you want, Post. All on one screen. Locking in starts
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
  dayId,
}: {
  /** The day being trained, for the Today's plan card. */
  dayId?: string | null;
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
  const { data: plan } = useDayPlan(dayId ?? null);
  // what the card says in public ("Block 5 · Week 1"); the day's own name stays on the client's screen
  const { data: publicTitle } = usePublicSessionTitle({ dayId });
  const cardTitle = publicTitle ?? "Workout";
  const { data: existing } = useMyPostForCompletion(completionId, !!completionId, "lockin");
  const [open, setOpen] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [look, setLook] = useState<LockTemplate>("lockin");
  const { user } = useAuth();
  const qc = useQueryClient();

  if (!activity?.enabled) return null;

  const done = !!existing;
  const time = lockInTimeLabel(existing?.locked_in_at);

  // Camera first, and the camera is the whole share. Already locked in → edit it.
  const start = () => {
    if (previewOnly) return void toast.message(PREVIEW_ONLY_MESSAGE);
    if (done) setOpen(true);
    else setCapturing(true);
  };

  return (
    <>
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
          <span className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-full text-white shadow-md shadow-primary/25", LOCK_GRADIENT)}>
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
            onOpenChange={setOpen}
            completionId={completionId}
            ensureStarted={ensureStarted}
            workoutTitle={cardTitle}
            athleteName={athleteName}
            existing={existing ?? null}
            pick={null}
            onCamera={() => {
              setOpen(false);
              setCapturing(true);
            }}
            onLibrary={() => {
              setOpen(false);
              setCapturing(true);
            }}
            plan={plan ?? []}
            initialTemplate={look}
          />
        </Suspense>
      )}

      {capturing && (
        <Suspense fallback={null}>
          <ShareStudio
            open={capturing}
            onClose={() => setCapturing(false)}
            chip={<CameraChip icon="🔒" title={workoutTitle} sub={existing ? "Update your lock in" : "Snap the gym, your setup, the vibe"} />}
            card={(() => {
              const c = lockInCameraCard({ workoutTitle: cardTitle, athleteName, plan: plan ?? [] });
              return { data: c.data, looks: c.looks, look: c.looks.includes(look) ? look : "lockin", onLook: (t) => setLook(t as LockTemplate) };
            })()}
            post={{
              key: `lock:${completionId ?? ""}:${existing?.id ?? ""}`,
              label: existing ? "Update" : "Post",
              caption: existing?.caption,
              visibility: existing?.visibility,
              extras: existing?.extra_media ?? null,
              attach: existing,
              onPost: async (a) => {
                if (!user?.id) throw new Error("Sign in again to post");
                // Always through the start path: the row can exist without being started.
                const id = await ensureStarted();
                if (!id) throw new Error("Couldn't start your session. Try again.");
                await shareToCommunity(qc, { userId: user.id, completionId: id, caption: a.caption, visibility: a.visibility, photo: a.photo, existing, extras: a.extras, lockIn: true, attach: a.attach });
                toast.success(
                  a.visibility === "community" ? (existing ? "Lock in updated 🔒" : "You're locked in 🔒") : a.visibility === "coach" ? "Sent to your coach 🔒" : "Saved to your profile",
                  {
                    description:
                      a.visibility === "community"
                        ? "The crew sees you showed up. Your numbers land on it when you finish."
                        : a.visibility === "coach"
                          ? "Only you and your coach can see it."
                          : "Only you can see it.",
                  },
                );
              },
            }}
          />
        </Suspense>
      )}
    </>
  );
}
