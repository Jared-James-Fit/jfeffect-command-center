export type SetupRequestKind = "agreement" | "goals";

/** Unknown, completed and already-requested records are never sent by a batch. */
export function pendingSetupRequests(input: {
  eligible: boolean;
  agreement: { needsSignature: boolean; requested: boolean } | null;
  goals: { complete: boolean; requested: boolean } | null;
}): SetupRequestKind[] {
  if (!input.eligible) return [];
  const result: SetupRequestKind[] = [];
  if (input.agreement?.needsSignature && !input.agreement.requested) result.push("agreement");
  if (input.goals && !input.goals.complete && !input.goals.requested) result.push("goals");
  return result;
}
