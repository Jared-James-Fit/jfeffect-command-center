import type { QueryClient } from "@tanstack/react-query";

/**
 * One-shot invalidation for every surface that renders workout schedule data
 * (calendar, Schedule Manager, portal workouts, Training Program hub, program
 * editor badges). Call this after ANY schedule write — editor Training Date
 * saves, Fix Calendar Issue, moves — so all surfaces converge without a
 * refresh.
 */
export function invalidateScheduleQueries(
  qc: QueryClient,
  opts: { clientId?: string | null; blockId?: string | null },
) {
  const { clientId, blockId } = opts;
  if (blockId) {
    void qc.invalidateQueries({ queryKey: ["block-schedule-instances", blockId] });
    void qc.invalidateQueries({ queryKey: ["block-day-completions", blockId] });
    void qc.invalidateQueries({ queryKey: ["pl-block-summary", blockId] });
    void qc.invalidateQueries({ queryKey: ["hub-block-schedule"] });
  }
  if (clientId) {
    void qc.invalidateQueries({ queryKey: ["client-schedule", clientId] });
    void qc.invalidateQueries({ queryKey: ["my-workouts", clientId] });
    void qc.invalidateQueries({ queryKey: ["workouts-experience-client", clientId] });
    void qc.invalidateQueries({ queryKey: ["missed-workouts", clientId] });
    void qc.invalidateQueries({ queryKey: ["scheduled-workouts-date", clientId] });
    void qc.invalidateQueries({ queryKey: ["schedulable-workouts", clientId] });
    void qc.invalidateQueries({ queryKey: ["client-program-hub", clientId] });
    void qc.invalidateQueries({ queryKey: ["hub-next-workout"] });
    void qc.invalidateQueries({ queryKey: ["schedule-timeline"] });
    void qc.invalidateQueries({ queryKey: ["block-current-week"] });
    void qc.invalidateQueries({ queryKey: ["schedule-move-context"] });
    void qc.invalidateQueries({ queryKey: ["week-sched-data"] });
    void qc.invalidateQueries({ queryKey: ["pl-block-summaries"] });
    void qc.invalidateQueries({ queryKey: ["pl-block-prog"] });
    void qc.invalidateQueries({ queryKey: ["pl-block-sched"] });
    void qc.invalidateQueries({ queryKey: ["resolved-client-days"] });
  }
}