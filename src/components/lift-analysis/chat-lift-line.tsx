/**
 * The quiet lines under a client's video in the coach chat (lift videos sent
 * in chat: chat-lift.ts, chat-lift-run.ts):
 *
 *   ChatLiftOffer  a video that isn't read yet: its progress while it's being
 *                  read, else (the coach) "Analyze bar path". Read on its own
 *                  within two days of being sent, on whichever side opens it.
 *   ChatLiftPlace  a read that isn't on a set: "Which set is this?" with its
 *                  best guess one tap away, or the workout's sets to pick
 *                  from; "Not a lift" takes the read off.
 *   ChatLiftOnSet  a read on a set: which one, and Change.
 *
 * Attach to workout (Nov 25 2026, filming reminders): a video sent in chat
 * counts as the workout's footage only once a person puts it on a set
 * (`set_video_attach_to_workout`, `set_video_mark_attached`); one the read
 * linked by itself offers Attach to workout to make it count.
 *
 * The heavy reading code loads only when a video is read.
 */
import { Suspense, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Activity, Check, ChevronRight, Link2, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { importWithRetry } from "@/lib/chunk-import";
import { lazyWithRetry } from "@/lib/lazy-chunk";
import { CHAT_LIFT_AUTO_HOURS, chatRunKey } from "@/lib/lift-analysis/chat-lift";
import { overallProgress } from "@/lib/lift-analysis/progress";
import { useRunningAnalysis } from "@/lib/lift-analysis/store";
import type { SetVideo } from "@/components/workout-day/set-video-cell";
import { cn } from "@/lib/utils";

const db = supabase as any;
// the set picker (and the logger code behind it) loads only when someone picks a set
const SetVideoMovePicker = lazyWithRetry(() =>
  import("@/components/workout-day/set-video-move").then((m) => ({
    default: m.SetVideoMovePicker,
  })),
);
const pickerFallback = (
  <div className="flex h-16 items-center justify-center text-muted-foreground">
    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
  </div>
);
const loadRun = () => importWithRetry(() => import("@/lib/lift-analysis/chat-lift-run"));

export type ChatSetVideo = {
  id: string;
  origin?: "set" | "chat";
  linked?: boolean;
  exercise?: string | null;
  set?: number | null;
  set_name?: string | null;
  day_id?: string | null;
  row_id?: string | null;
  label?: string | null;
  /** A person put it on its set: it counts as the workout's footage. */
  attached?: boolean;
  suggest?: { row_id: string; set: number; exercise?: string; set_name?: string } | null;
};

type Msg = { id: string; created_at: string; body?: string | null };

/** A person put this chat video on its set: it's the workout's footage now (filming reminders). */
const markAttached = (id: string) => db.rpc("set_video_mark_attached", { _id: id }).then(() => {}, () => {});

const lineCls =
  "flex h-10 w-full min-w-0 items-center gap-2 rounded-lg px-1 text-left text-sm text-muted-foreground";

export function ChatLiftOffer({
  message,
  storagePath,
  clientId,
  staff,
  className,
}: {
  message: Msg;
  storagePath: string;
  clientId: string;
  staff: boolean;
  className?: string;
}) {
  const qc = useQueryClient();
  const running = useRunningAnalysis(chatRunKey(storagePath));
  const [state, setState] = useState<"idle" | "queued" | "not_a_lift">("idle");
  const fresh = Date.now() - Date.parse(message.created_at) < CHAT_LIFT_AUTO_HOURS * 3600_000;

  const start = (force: boolean) => {
    setState("queued");
    void loadRun()
      .then(async (m) => {
        if (!force && m.wasTried(storagePath)) return setState("idle");
        const out = await m.queueChatLift(
          {
            messageId: message.id,
            storagePath,
            clientId,
            caption: message.body ?? "",
            sentAt: message.created_at,
            by: staff ? "coach" : "athlete",
          },
          { force },
        );
        if (out === "not_a_lift") setState(force ? "idle" : "not_a_lift");
        else setState("idle");
        if (out === "failed" && force) toast.error("That video couldn't be read. Try again.");
        void qc.invalidateQueries({ queryKey: ["messages"] });
      })
      .catch(() => setState("idle"));
  };

  // read on its own while it's fresh (the athlete's phone usually already has)
  useEffect(() => {
    if (!fresh) return;
    const t = window.setTimeout(() => start(false), 1500);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storagePath, fresh]);

  if (running)
    return (
      <div className={cn(lineCls, className)} data-chat-lift="running">
        <Activity className="h-4 w-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate tabular-nums">
          Reading bar path… {Math.round(100 * overallProgress(running))}%
        </span>
      </div>
    );
  if (!staff)
    return (
      <AttachToWorkout message={message} storagePath={storagePath} className={className} />
    );
  return (
    <button
      type="button"
      onClick={() => start(true)}
      disabled={state === "queued"}
      className={cn(lineCls, "hover:text-foreground", className)}
      data-chat-lift="offer"
    >
      {state === "queued" ? (
        <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
      ) : (
        <Activity className="h-4 w-4 shrink-0" />
      )}
      <span className="min-w-0 flex-1 truncate">Analyze bar path</span>
      <ChevronRight className="h-4 w-4 shrink-0" />
    </button>
  );
}

/** The SetVideo the move picker works with, from the chat card's own details. */
function asSetVideo(sv: ChatSetVideo, createdAt: string, storagePath: string): SetVideo {
  return {
    id: sv.id,
    row_id: sv.row_id ?? null,
    result_id: null,
    warmup_id: null,
    // not on a set yet: a number no set has, so no chip reads as "where it is now"
    set_index: sv.set ?? -1,
    exercise_name: sv.exercise ?? null,
    label: sv.label ?? "",
    origin: "chat",
    storage_path: storagePath,
    thumbnail_path: null,
    duration_s: null,
    width: null,
    height: null,
    size_bytes: null,
    message_id: null,
    uploaded_by: "",
    created_at: createdAt,
  };
}

export function ChatLiftPlace({
  sv,
  message,
  storagePath,
  clientId,
  className,
}: {
  sv: ChatSetVideo;
  message: Msg;
  storagePath: string;
  clientId: string;
  className?: string;
}) {
  const qc = useQueryClient();
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState<"yes" | "no" | null>(null);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["messages"] });
    void qc.invalidateQueries({ queryKey: ["lift-analyses"] });
  };
  const yes = async () => {
    if (!sv.suggest || busy) return;
    setBusy("yes");
    const { error } = await db.rpc("set_video_move", {
      _id: sv.id,
      _row_id: sv.suggest.row_id,
      _set_index: sv.suggest.set,
    });
    setBusy(null);
    if (error) return toast.error(error.message || "Couldn't put it on that set. Try again.");
    await markAttached(sv.id);
    refresh();
  };
  const notALift = async () => {
    if (busy) return;
    setBusy("no");
    const { error } = await db.rpc("chat_video_unlift", { _id: sv.id });
    setBusy(null);
    if (error) return toast.error("Couldn't change that. Try again.");
    refresh();
  };
  if (picking && sv.day_id)
    return (
      <Suspense fallback={pickerFallback}>
        <SetVideoMovePicker
          video={asSetVideo(sv, message.created_at, storagePath)}
          dayId={sv.day_id}
          clientId={clientId}
          chat
          onCancel={() => setPicking(false)}
          onMoved={() => {
            setPicking(false);
            void markAttached(sv.id).then(refresh);
          }}
        />
      </Suspense>
    );
  return (
    <div
      className={cn("flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 px-1 text-sm", className)}
      data-chat-lift="place"
    >
      <span className="min-w-0 flex-1 text-muted-foreground">
        {sv.suggest
          ? `Is this ${sv.suggest.exercise || "this lift"} · ${sv.suggest.set_name || `Set ${sv.suggest.set}`}?`
          : sv.day_id
            ? "Which set is this?"
            : "Not linked to a workout."}
      </span>
      <span className="flex shrink-0 items-center gap-1">
        {sv.suggest && (
          <button
            type="button"
            onClick={() => void yes()}
            className="inline-flex h-9 items-center gap-1 rounded-full bg-foreground px-3 text-[13px] font-medium text-background active:scale-95"
            data-chat-lift-yes
          >
            {busy === "yes" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Check className="h-3.5 w-3.5" />
            )}
            Yes
          </button>
        )}
        {sv.day_id && (
          <button
            type="button"
            onClick={() => setPicking(true)}
            className="inline-flex h-9 items-center rounded-full bg-muted px-3 text-[13px] font-medium active:scale-95"
            data-chat-lift-pick
          >
            {sv.suggest ? "Another set" : "Pick the set"}
          </button>
        )}
        <button
          type="button"
          onClick={() => void notALift()}
          className="inline-flex h-9 items-center rounded-full px-2 text-[13px] text-muted-foreground hover:text-foreground"
          data-chat-lift-not
        >
          {busy === "no" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Not a lift"}
        </button>
      </span>
    </div>
  );
}

export function ChatLiftOnSet({
  sv,
  message,
  storagePath,
  clientId,
  className,
}: {
  sv: ChatSetVideo;
  message: Msg;
  storagePath: string;
  clientId: string;
  className?: string;
}) {
  const qc = useQueryClient();
  const [picking, setPicking] = useState(false);
  if (picking && sv.day_id)
    return (
      <Suspense fallback={pickerFallback}>
        <SetVideoMovePicker
          video={asSetVideo(sv, message.created_at, storagePath)}
          dayId={sv.day_id}
          clientId={clientId}
          chat
          onCancel={() => setPicking(false)}
          onMoved={() => {
            setPicking(false);
            void markAttached(sv.id).then(() => qc.invalidateQueries({ queryKey: ["messages"] }));
          }}
        />
      </Suspense>
    );
  return (
    <div
      className={cn(
        "flex min-w-0 items-center gap-2 px-1 text-[13px] text-muted-foreground",
        className,
      )}
      data-chat-lift="on-set"
    >
      <span className="min-w-0 flex-1 truncate">
        On {sv.exercise ?? "its set"} · {sv.set_name || (sv.set ? `Set ${sv.set}` : "")}
      </span>
      {!sv.attached && (
        <button
          type="button"
          onClick={() =>
            void markAttached(sv.id).then(() => {
              toast.success("Attached to your workout");
              void qc.invalidateQueries({ queryKey: ["messages"] });
            })
          }
          className="h-9 shrink-0 rounded-full px-2 font-medium text-foreground/80 hover:text-foreground"
          data-chat-lift-attach
        >
          Attach to workout
        </button>
      )}
      {sv.day_id && (
        <button
          type="button"
          onClick={() => setPicking(true)}
          className="h-9 shrink-0 rounded-full px-2 font-medium text-foreground/80 hover:text-foreground"
          data-chat-lift-change
        >
          Change
        </button>
      )}
    </div>
  );
}

/**
 * A video the athlete sent in their coach chat, on no workout yet: Attach to
 * workout puts it on the workout nearest the message (one done in the 18 hours
 * before it was sent), then they pick the set, so it counts as that workout's
 * footage. The chat's message never changes.
 */
function AttachToWorkout({ message, storagePath, className }: { message: Msg; storagePath: string; className?: string }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const attach = async () => {
    if (busy) return;
    setBusy(true);
    const { data, error } = await db.rpc("set_video_attach_to_workout", { _message_id: message.id, _storage_path: storagePath });
    setBusy(false);
    if (error) return toast.error(error.message || "Couldn't attach it. Try again.");
    if (!data?.day_id) toast("No workout logged around this video to attach it to.");
    else if (data.linked) toast.success("Attached to your workout");
    // otherwise the line under it now asks which set it is
    void qc.invalidateQueries({ queryKey: ["messages"] });
  };
  return (
    <button
      type="button"
      onClick={() => void attach()}
      disabled={busy}
      className={cn(lineCls, "hover:text-foreground", className)}
      data-chat-attach-workout
    >
      {busy ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" /> : <Link2 className="h-4 w-4 shrink-0" />}
      <span className="min-w-0 flex-1 truncate">Attach to workout</span>
    </button>
  );
}
