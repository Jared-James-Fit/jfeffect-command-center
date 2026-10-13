import { createClientAdapter } from "./client-adapter";
import type { WorkoutContextAdapter, WorkoutContextRef } from "./types";

export * from "./types";
export { createClientAdapter };

/**
 * Build the adapter from a context reference. Shared components accept a
 * `WorkoutContextAdapter` prop and never construct one themselves. Every
 * athlete (coaching client or JF member) trains on the same program system
 * now, so there is one kind; the member-only adapter retired with /m.
 */
export function buildWorkoutAdapter(ref: WorkoutContextRef): WorkoutContextAdapter {
  return createClientAdapter(ref);
}
