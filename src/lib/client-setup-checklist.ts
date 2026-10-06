import { isBasicInfoComplete } from "@/lib/basic-info";
import { isGoalsSetupComplete, type ClientGoalsSetupRow } from "@/lib/client-goals/schema";
import { needsSignature, type AgreementState } from "@/lib/coaching-agreement/rules";

/**
 * The client's "Complete your setup" checklist, defined once. The portal banner shows
 * it to the client and the admin client profile shows the same steps, so the two can
 * never disagree about what's done. Every step reads the client record (or their
 * Goals & Setup row) directly, never a separate copy.
 */
export type SetupChecklistKey =
  | "agreement"
  | "profile_picture"
  | "basic_info"
  | "training_schedule"
  | "goals_setup";

export type SetupChecklistStep = { key: SetupChecklistKey; done: boolean };

export function setupChecklistSteps(input: {
  client: Record<string, any> | null | undefined;
  goals: ClientGoalsSetupRow | null | undefined;
  /** Pass only when the Coaching Agreement applies to this client. */
  agreement?: AgreementState | null;
}): SetupChecklistStep[] {
  const c = input.client;
  const steps: SetupChecklistStep[] = [
    { key: "profile_picture", done: !!c?.profile_picture_url && !c?.profile_picture_needs_update },
    { key: "basic_info", done: !!c && isBasicInfoComplete(c) },
    { key: "training_schedule", done: !!c?.training_schedule_completed },
    { key: "goals_setup", done: isGoalsSetupComplete(input.goals ?? null) },
  ];
  // The agreement is the one mandatory step, so it leads the list.
  if (input.agreement) steps.unshift({ key: "agreement", done: !needsSignature(input.agreement) });
  return steps;
}
