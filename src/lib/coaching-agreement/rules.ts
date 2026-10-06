/**
 * Pure rules for the Coaching Agreement: who must sign, what state they are in,
 * minor detection and the launch-popup dismissal window. No I/O, so every rule is
 * unit-tested without a database.
 */
import { RESIGN_REQUIRED_BELOW_VERSION, compareVersions } from "./content";

export type SignatureSummary = {
  id: string;
  version: string;
  signedAt: string;
  typedName: string;
  method: "drawn" | "typed";
  hasGuardian: boolean;
};

export type AgreementReason = "never_signed" | "new_version" | "admin_request";
export type ExemptKind = "offline_signed" | "not_required";

export type AgreementState =
  | { state: "exempt"; kind: ExemptKind; note: string | null; setAt: string | null }
  | { state: "signed"; signature: SignatureSummary }
  | {
      state: "needs_signature";
      reason: AgreementReason;
      /** The latest earlier signature, if any, so the UI can say "we've updated it". */
      previous: SignatureSummary | null;
      requestedAt: string | null;
      requestNote: string | null;
    };

export type ResolveInput = {
  latestSignature: SignatureSummary | null;
  exempt: { kind: ExemptKind; note: string | null; setAt: string | null } | null;
  resignRequestedAt: string | null;
  resignNote: string | null;
};

/**
 * Decision order matters:
 *  1. An admin exemption (signed on paper / not required) always wins.
 *  2. No signature at all means the client has never signed.
 *  3. A signature on a version below the re-sign threshold means the terms changed.
 *  4. A signature older than an admin's "send another one" request is superseded.
 */
export function resolveAgreementState(input: ResolveInput): AgreementState {
  if (input.exempt) {
    return {
      state: "exempt",
      kind: input.exempt.kind,
      note: input.exempt.note,
      setAt: input.exempt.setAt,
    };
  }
  const sig = input.latestSignature;
  if (!sig) {
    return {
      state: "needs_signature",
      reason: "never_signed",
      previous: null,
      requestedAt: input.resignRequestedAt,
      requestNote: input.resignNote,
    };
  }
  if (compareVersions(sig.version, RESIGN_REQUIRED_BELOW_VERSION) < 0) {
    return {
      state: "needs_signature",
      reason: "new_version",
      previous: sig,
      requestedAt: input.resignRequestedAt,
      requestNote: input.resignNote,
    };
  }
  if (
    input.resignRequestedAt &&
    new Date(sig.signedAt).getTime() < new Date(input.resignRequestedAt).getTime()
  ) {
    return {
      state: "needs_signature",
      reason: "admin_request",
      previous: sig,
      requestedAt: input.resignRequestedAt,
      requestNote: input.resignNote,
    };
  }
  return { state: "signed", signature: sig };
}

export function needsSignature(state: AgreementState): boolean {
  return state.state === "needs_signature";
}

/** Whole years between a YYYY-MM-DD date of birth and `on`. Null for an unusable date. */
export function ageOnDate(dateOfBirth: string | null | undefined, on: Date): number | null {
  if (!dateOfBirth || !/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)) return null;
  const [y, m, d] = dateOfBirth.split("-").map(Number);
  const dob = new Date(Date.UTC(y, m - 1, d));
  if (dob.getUTCFullYear() !== y || dob.getUTCMonth() !== m - 1 || dob.getUTCDate() !== d) {
    return null;
  }
  let age = on.getUTCFullYear() - y;
  const beforeBirthday =
    on.getUTCMonth() < m - 1 || (on.getUTCMonth() === m - 1 && on.getUTCDate() < d);
  if (beforeBirthday) age -= 1;
  return age;
}

export const AGE_OF_MAJORITY = 18;

/** A missing or unreadable date of birth is not treated as a minor; the form requires one. */
export function isMinor(dateOfBirth: string | null | undefined, on: Date): boolean {
  const age = ageOnDate(dateOfBirth, on);
  return age !== null && age < AGE_OF_MAJORITY;
}

/** Normalises a name for a mismatch check: case, accents, punctuation and spacing ignored. */
export function normalizeName(name: string | null | undefined): string {
  return (
    (name ?? "")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      // "O'Brien" and "OBrien" are the same name; hyphens and other punctuation separate words.
      .replace(/['’`]/g, "")
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

export function namesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  return na.length > 0 && na === nb;
}

/**
 * Launch popup dismissal. "Not now" hides the popup for the rest of this app
 * session, but if the app sits in the background longer than RESUME_AFTER_MS the
 * client has effectively closed and reopened it, so the popup returns.
 */
export const POPUP_RESUME_AFTER_MS = 10 * 60 * 1000;

export function isPopupDismissed(args: {
  dismissedAt: number | null;
  hiddenSince: number | null;
  now: number;
}): boolean {
  if (args.dismissedAt === null) return false;
  if (args.hiddenSince !== null && args.now - args.hiddenSince >= POPUP_RESUME_AFTER_MS) {
    return false;
  }
  return true;
}

/** Roster ordering for the admin page: most urgent first. */
export type RosterStatus =
  | "never_signed"
  | "admin_request"
  | "new_version"
  | "signed"
  | "exempt"
  | "no_account";

const ROSTER_ORDER: Record<RosterStatus, number> = {
  never_signed: 0,
  admin_request: 1,
  new_version: 2,
  no_account: 3,
  signed: 4,
  exempt: 5,
};

export function rosterStatusOf(state: AgreementState, hasAccount: boolean): RosterStatus {
  if (state.state === "exempt") return "exempt";
  if (state.state === "signed") return "signed";
  if (!hasAccount) return "no_account";
  return state.reason;
}

export function compareRosterStatus(a: RosterStatus, b: RosterStatus): number {
  return ROSTER_ORDER[a] - ROSTER_ORDER[b];
}

export const ROSTER_STATUS_LABEL: Record<RosterStatus, string> = {
  never_signed: "Not signed",
  admin_request: "Re-sign requested",
  new_version: "Needs updated version",
  signed: "Signed",
  exempt: "Not required / paper",
  no_account: "No app account yet",
};
