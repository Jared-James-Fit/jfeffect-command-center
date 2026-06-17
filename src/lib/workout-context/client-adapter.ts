/**
 * Coaching client adapter. Phase 1 skeleton — methods throw NotImplemented
 * until Phase 2 wires them onto the existing pl_* queries that the current
 * coaching components use today. The signatures below pin the contract.
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

export function createClientAdapter(ref: WorkoutContextRef): WorkoutContextAdapter {
  if (ref.kind !== "client") throw new Error("createClientAdapter requires kind=client");
  return {
    kind: "client",
    ref,
    capabilities: {
      canEditTemplate: false,
      canEditOwnLogs: true,
      canReschedule: true,
      canSubstituteExercise: true,
      canSeeCoachNotes: true,
    },
    async listSchedule(_opts): Promise<WorkoutScheduleDay[]> {
      throw new NotImplemented("listSchedule", "client");
    },
    async listCompletions(_opts): Promise<WorkoutCompletion[]> {
      throw new NotImplemented("listCompletions", "client");
    },
    async reschedule(_input: RescheduleInput): Promise<void> {
      throw new NotImplemented("reschedule", "client");
    },
    async logSet(_input: LogSetInput): Promise<void> {
      throw new NotImplemented("logSet", "client");
    },
    async completeDay(_dayId: string): Promise<void> {
      throw new NotImplemented("completeDay", "client");
    },
  };
}