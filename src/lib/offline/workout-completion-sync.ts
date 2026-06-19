// Phase 3: drain offline workout completions into the durable sync queue.
//
// Phase 2 saved finished-while-offline workouts to localStorage
// (`lov:offline-workout-completions:v1`). This module:
//   1. Registers a queue handler `workout_completion_finish` that calls the
//      idempotent `completeWorkout` server fn. Server-side upsert prevents
//      duplicate completion rows for the same (client, day).
//   2. On boot + on every `online` event, moves each stored completion into
//      `enqueueOfflineWrite()` with a stable id so the existing retry loop
//      drains it. Local store entries are removed only after enqueue (the
//      queue then owns durability + retries).
//
// Status surfaces through the existing `useQueueAggregateStatus` /
// `WorkoutSyncBanner` — no new UI required.

import { completeWorkout } from "@/lib/workout-completion.functions";
import {
  enqueueOfflineWrite,
  registerQueueHandler,
} from "@/lib/workout-offline-queue";
import {
  clearOfflineCompletion,
  listOfflineCompletions,
} from "@/lib/offline/workout-completion-store";

let registered = false;

export function registerWorkoutCompletionSync() {
  if (registered) return;
  registered = true;

  registerQueueHandler("workout_completion_finish", async (payload: any) => {
    // completeWorkout is idempotent: it looks up the existing pl_day_completions
    // row by (client_id, day_id) and updates in place, so re-runs on retry
    // never create duplicates.
    await completeWorkout({ data: payload });
  });

  if (typeof window === "undefined") return;

  const drain = () => {
    for (const entry of listOfflineCompletions()) {
      enqueueOfflineWrite({
        id: `workout_completion:${entry.id}`,
        label: "Workout completion",
        handlerKey: "workout_completion_finish",
        payload: entry.payload,
      });
      // Local store has handed off durability to the queue (which itself
      // persists to localStorage). Removing here keeps a single source of
      // truth and avoids re-enqueueing on the next boot.
      clearOfflineCompletion(entry.dayId, entry.clientId);
    }
  };

  // Run shortly after boot so the queue + handler are wired before drain.
  setTimeout(drain, 500);
  window.addEventListener("online", drain);
}

// Auto-register on module load (idempotent).
registerWorkoutCompletionSync();