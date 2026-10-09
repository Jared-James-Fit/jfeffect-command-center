import { useMemo, useState } from "react";
import { format } from "date-fns";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { buildShareCardFields, type CommunityVisibility } from "@/lib/community";
import { shareToCommunity, useCompletionPreview, useMyPostForCompletion } from "@/lib/community.queries";
import { cameraLooks, type ShareTemplate } from "@/lib/workout-share-card";
import type { CameraCard, StudioPost } from "@/components/community/share-studio";

export type StudioWorkout = { completion_id: string; title: string; athlete_name: string | null };

/** What a fresh post says, by who it's for. */
export function postedToast(visibility: CommunityVisibility, lockIn: boolean, updated: boolean) {
  if (visibility === "coach") return { title: lockIn ? "Sent to your coach 🔒" : "Sent to your coach", description: "Only you and your coach can see it." };
  if (visibility === "private") return { title: "Saved to your profile", description: "Only you can see it." };
  if (lockIn) return { title: updated ? "Lock in updated 🔒" : "You're locked in 🔒", description: "The crew sees you showed up. Your numbers land on it when you finish." };
  return { title: updated ? "Post updated 🔥" : "You're in the feed 🔥", description: undefined };
}

/**
 * Everything the studio needs for a finished workout: its looks (Photo, vs
 * last time, Receipt, Streak, Stats, Volume) built from the canonical stats,
 * and posting to it (editing the post if there already is one). Shared by
 * Community "+ Share" and the workout recap's Share, so both feel the same.
 */
export function useWorkoutStudio(target: StudioWorkout | null, unit: "kg" | "lb", enabled: boolean, draftCaption?: string) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [look, setLook] = useState<ShareTemplate | null>(null);
  const id = target?.completion_id ?? "";
  const { data: stats } = useCompletionPreview(id, enabled && !!target);
  const { data: existing } = useMyPostForCompletion(target?.completion_id, enabled && !!target);

  const built = useMemo(() => {
    if (!stats || !target) return null;
    const data = {
      format: "story" as const,
      ...buildShareCardFields({
        stats,
        unit,
        athleteName: (target.athlete_name ?? "").trim().split(/\s+/)[0] || null,
        workoutTitle: target.title,
        dateLabel: format(new Date(stats.completed_at), "EEE, MMM d"),
      }),
    };
    return { data, looks: cameraLooks(data) };
  }, [stats, target, unit]);
  const current = built ? (look && built.looks.includes(look) ? look : built.looks[0]) : null;
  const card: CameraCard | null = built && current ? { data: built.data, looks: built.looks, look: current, onLook: setLook } : null;

  const post: StudioPost | null = target
    ? {
        key: `workout:${target.completion_id}:${existing?.id ?? ""}`,
        label: existing ? "Update" : "Post",
        // editing keeps what the post says; a new one starts from any caption they already wrote
        caption: existing ? existing.caption : draftCaption,
        visibility: existing?.visibility,
        hideLoads: existing?.hide_loads,
        showHideLoads: true,
        extras: existing?.extra_media ?? null,
        onPost: async (a) => {
          if (!user?.id) throw new Error("Sign in again to post");
          await shareToCommunity(qc, { userId: user.id, completionId: target.completion_id, caption: a.caption, visibility: a.visibility, hideLoads: a.hideLoads, photo: a.photo, existing, extras: a.extras });
          const t = postedToast(a.visibility, false, !!existing);
          toast.success(t.title, { description: t.description, action: a.visibility === "community" ? { label: "View", onClick: () => navigate({ to: "/portal/community", hash: "feed" }) } : undefined });
        },
      }
    : null;

  return { card, post, ready: !!built, resetLook: () => setLook(null) };
}

