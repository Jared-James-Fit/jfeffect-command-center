/**
 * Membership adapter. Phase 1 skeleton — methods throw NotImplemented
 * until Phase 2 wires them onto member_plan_enrollments / member_set_logs /
 * member_workout_completions. Capabilities deliberately deny coach-only
 * write paths (template edits, coach notes) so members cannot escalate
 * even if a shared component forgets to check.
 */
import {
  NotImplemented,
  type WorkoutContextAdapter,
  type WorkoutContextRef,
  type WorkoutScheduleDay,
  type WorkoutCompletion,
  type RescheduleInput,
  type LogSetInput,
} from "./types";

export function createMemberAdapter(ref: WorkoutContextRef): WorkoutContextAdapter {
  if (ref.kind !== "member") throw new Error("createMemberAdapter requires kind=member");
  if (!ref.enrollmentId) throw new Error("member adapter requires enrollmentId");
  return {
    kind: "member",
    ref,
    capabilities: {
      canEditTemplate: false,
      canEditOwnLogs: true,
      canReschedule: true,
      canSubstituteExercise: false, // membership programs are static library entries
      canSeeCoachNotes: false,
    },
    async listSchedule(_opts): Promise<WorkoutScheduleDay[]> {
      throw new NotImplemented("listSchedule", "member");
    },
    async listCompletions(_opts): Promise<WorkoutCompletion[]> {
      throw new NotImplemented("listCompletions", "member");
    },
    async reschedule(_input: RescheduleInput): Promise<void> {
      throw new NotImplemented("reschedule", "member");
    },
    async logSet(_input: LogSetInput): Promise<void> {
      throw new NotImplemented("logSet", "member");
    },
    async completeDay(_dayId: string): Promise<void> {
      throw new NotImplemented("completeDay", "member");
    },
  };
}