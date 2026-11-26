export type TeamSetupInput = { createdAt: string | null; lastSignInAt: string | null; emailConfirmed: boolean; twoStepRequired: boolean; twoStepEnrolled: boolean | null };
type Step = { label: string; state: "Completed" | "Awaiting team member" | "Check status"; tab: "account" | "access" };
export function teamSetupSteps(d: TeamSetupInput): Step[] {
  const steps: Step[] = [
    { label: "Team login created", state: d.createdAt ? "Completed" : "Check status", tab: "account" },
    { label: "Email confirmed", state: d.emailConfirmed ? "Completed" : "Awaiting team member", tab: "account" },
    { label: "First sign-in", state: d.lastSignInAt ? "Completed" : "Awaiting team member", tab: "account" },
  ];
  if (d.twoStepRequired || d.twoStepEnrolled) steps.push({ label: "Two-step sign-in", state: d.twoStepEnrolled === null ? "Check status" : d.twoStepEnrolled ? "Completed" : "Awaiting team member", tab: "access" });
  return steps;
}
