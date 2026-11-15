/**
 * The reasons a coach picks from when deactivating an account. Deactivating
 * and reactivating themselves are lifecycle.functions.ts (one path for the
 * person, their coach and an admin).
 */
export const DEACTIVATION_REASONS = [
  "Coaching ended",
  "Payment stopped",
  "Paused coaching",
  "Client requested cancellation",
  "Inactive client",
  "Test client",
  "Other",
] as const;
