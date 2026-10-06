/**
 * Builds the admin roster: one row per client with an app account, combining the
 * client's latest signature, any admin state (re-sign request, exemption, reminders)
 * and the legacy agreement fields. Pure, so it is unit-tested without a database.
 */
import {
  compareRosterStatus,
  resolveAgreementState,
  rosterStatusOf,
  type AgreementState,
  type ExemptKind,
  type RosterStatus,
  type SignatureSummary,
} from "./rules";

export type RosterClientInput = {
  id: string;
  full_name: string | null;
  email: string | null;
  user_id: string | null;
  assigned_coach_id: string | null;
  agreement_signed: boolean | null;
  agreement_signed_date: string | null;
  agreement_version: string | null;
  last_signed_in_at: string | null;
};

export type RosterSignatureInput = {
  id: string;
  client_id: string | null;
  signed_at: string;
  typed_name: string;
  signature_method: "drawn" | "typed";
  has_guardian: boolean;
  version: string;
};

export type RosterStateInput = {
  client_id: string;
  resign_requested_at: string | null;
  resign_note: string | null;
  exempt_kind: ExemptKind | null;
  exempt_note: string | null;
  exempt_set_at: string | null;
  last_reminded_at: string | null;
  reminder_count: number | null;
};

export type RosterRow = {
  clientId: string;
  name: string;
  email: string | null;
  coachId: string | null;
  hasAccount: boolean;
  status: RosterStatus;
  state: AgreementState;
  latestSignature: SignatureSummary | null;
  signatureCount: number;
  legacy: { signed: boolean; version: string | null; date: string | null };
  resignRequestedAt: string | null;
  resignNote: string | null;
  lastRemindedAt: string | null;
  reminderCount: number;
  lastSignedInAt: string | null;
};

export function toSignatureSummary(row: RosterSignatureInput): SignatureSummary {
  return {
    id: row.id,
    version: row.version,
    signedAt: row.signed_at,
    typedName: row.typed_name,
    method: row.signature_method,
    hasGuardian: row.has_guardian,
  };
}

export function buildRoster(
  clients: RosterClientInput[],
  signatures: RosterSignatureInput[],
  states: RosterStateInput[],
): RosterRow[] {
  const latestByClient = new Map<string, RosterSignatureInput>();
  const countByClient = new Map<string, number>();
  for (const sig of signatures) {
    if (!sig.client_id) continue;
    countByClient.set(sig.client_id, (countByClient.get(sig.client_id) ?? 0) + 1);
    const current = latestByClient.get(sig.client_id);
    if (!current || new Date(sig.signed_at).getTime() > new Date(current.signed_at).getTime()) {
      latestByClient.set(sig.client_id, sig);
    }
  }
  const stateByClient = new Map(states.map((s) => [s.client_id, s]));

  const rows: RosterRow[] = clients.map((client) => {
    const latest = latestByClient.get(client.id) ?? null;
    const adminState = stateByClient.get(client.id) ?? null;
    const state = resolveAgreementState({
      latestSignature: latest ? toSignatureSummary(latest) : null,
      exempt: adminState?.exempt_kind
        ? {
            kind: adminState.exempt_kind,
            note: adminState.exempt_note,
            setAt: adminState.exempt_set_at,
          }
        : null,
      resignRequestedAt: adminState?.resign_requested_at ?? null,
      resignNote: adminState?.resign_note ?? null,
    });
    const hasAccount = !!client.user_id;
    return {
      clientId: client.id,
      name: client.full_name?.trim() || client.email || "Unnamed client",
      email: client.email,
      coachId: client.assigned_coach_id,
      hasAccount,
      status: rosterStatusOf(state, hasAccount),
      state,
      latestSignature: latest ? toSignatureSummary(latest) : null,
      signatureCount: countByClient.get(client.id) ?? 0,
      legacy: {
        signed: !!client.agreement_signed,
        version: client.agreement_version,
        date: client.agreement_signed_date,
      },
      resignRequestedAt: adminState?.resign_requested_at ?? null,
      resignNote: adminState?.resign_note ?? null,
      lastRemindedAt: adminState?.last_reminded_at ?? null,
      reminderCount: adminState?.reminder_count ?? 0,
      lastSignedInAt: client.last_signed_in_at,
    };
  });

  return rows.sort(
    (a, b) => compareRosterStatus(a.status, b.status) || a.name.localeCompare(b.name),
  );
}

export type RosterCounts = Record<RosterStatus, number> & {
  total: number;
  /** Clients who must still sign (never signed, re-sign requested, or newer version). */
  outstanding: number;
};

export function summarizeRoster(rows: RosterRow[]): RosterCounts {
  const counts: RosterCounts = {
    never_signed: 0,
    admin_request: 0,
    new_version: 0,
    signed: 0,
    exempt: 0,
    no_account: 0,
    total: rows.length,
    outstanding: 0,
  };
  for (const row of rows) counts[row.status] += 1;
  counts.outstanding = counts.never_signed + counts.admin_request + counts.new_version;
  return counts;
}
