import { createClientAdapter } from "./client-adapter";
import { createMemberAdapter } from "./member-adapter";
import type { WorkoutContextAdapter, WorkoutContextRef } from "./types";

export * from "./types";
export { createClientAdapter, createMemberAdapter };

/**
 * Build the right adapter from a context reference. Shared components
 * should accept a `WorkoutContextAdapter` prop and never construct one
 * themselves — so route-level code owns the kind decision (and the flag
 * check that gates whether the unified UI is used at all).
 */
export function buildWorkoutAdapter(ref: WorkoutContextRef): WorkoutContextAdapter {
  return ref.kind === "client" ? createClientAdapter(ref) : createMemberAdapter(ref);
}