export const NATIVE_AGREEMENT_TITLE = "JF Effect Coaching Agreement";
export const NATIVE_AGREEMENT_VERSION = "v1.0";

export const NATIVE_SIGNATURE_METHODS = ["typed", "drawn"] as const;
export type NativeSignatureMethod = (typeof NATIVE_SIGNATURE_METHODS)[number];

export const NATIVE_ARTIFACT_STATUSES = ["not_requested", "pending", "ready", "failed"] as const;
export type NativeArtifactStatus = (typeof NATIVE_ARTIFACT_STATUSES)[number];

export const DEFERRED_NON_CLIENT_SIGNER_ROLES = [
  "payor",
  "guardian",
  "minor_assent",
  "coach_countersigner",
] as const;

export function isNativeSignatureMethod(value: unknown): value is NativeSignatureMethod {
  return (
    typeof value === "string" && (NATIVE_SIGNATURE_METHODS as readonly string[]).includes(value)
  );
}

export function requiresDeferredNonClientFlow(role: string): boolean {
  return (DEFERRED_NON_CLIENT_SIGNER_ROLES as readonly string[]).includes(role);
}

export function requireKnownDateOfBirth(dateOfBirth: string | null | undefined): void {
  if (!dateOfBirth) {
    throw new Error("Date of birth is required before this native agreement can be signed");
  }
}

export function resolveArtifactState(input: {
  completed: boolean;
  rendered: boolean;
  failed: boolean;
}): NativeArtifactStatus {
  if (!input.completed) return "not_requested";
  if (input.rendered) return "ready";
  if (input.failed) return "failed";
  return "pending";
}

export function assertSupportedNativeSignerRoles(roles: readonly string[]): void {
  const deferred = roles.find(requiresDeferredNonClientFlow);
  if (deferred) {
    throw new Error(`Native ${deferred} signing is not available in v1`);
  }
  if (roles.some((role) => role !== "client")) {
    throw new Error("Native agreement v1 supports an authenticated client signer only");
  }
}
