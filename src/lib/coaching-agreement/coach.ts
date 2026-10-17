/**
 * Who the agreement names as the client's coach, and how that name goes into the text.
 *
 * The legal party never changes: Jared McIntyre, carrying on business as JF Effect. What changes
 * per client is the person who actually coaches them. The published text carries a `{{coach}}`
 * token, so every client signs the same words (one hash per version); the name that filled the
 * token is saved with the signature, so the signed copy always shows exactly what they saw.
 *
 * Pure rules, no I/O and no agreement text, so the signed-copy viewer can use them cheaply.
 */
import type { AgreementContent } from "./content";
import { COACH } from "./business";

export const COACH_TOKEN = "{{coach}}";

/** What the token reads when nobody in particular is known (the public page, an old record). */
export const GENERIC_COACH_NAME = "the JF Effect coach assigned to you";

/** The fields of a `coaches` row these rules read. */
export type CoachRow = {
  id: string;
  user_id?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  full_name?: string | null;
  email?: string | null;
  archived?: boolean | null;
  status?: string | null;
};

export type AgreementCoachSource = "assigned" | "sender" | "owner";

export type AgreementCoach = {
  /** The name written into the agreement. */
  name: string;
  /** assigned: the client's coach. sender: whoever sent it (no coach assigned). owner: neither. */
  source: AgreementCoachSource;
  coachId: string | null;
  userId: string | null;
};

const clean = (v: string | null | undefined) => (v ?? "").replace(/\s+/g, " ").trim();

/** The owner's coach profile is the one on the business's official email address. */
export function isOwnerCoach(row: Pick<CoachRow, "email">): boolean {
  return clean(row.email).toLowerCase() === COACH.email.toLowerCase();
}

/**
 * The name a coach goes by in a legal document. The owner's coach profile carries a brand name
 * ("Jared James Fit"), so the owner is always named as the operator. Anyone else: first and last
 * name when both are filled in, otherwise the full name. Null when there is nothing usable.
 */
export function legalNameOfCoach(row: CoachRow): string | null {
  if (isOwnerCoach(row)) return COACH.operator;
  const first = clean(row.first_name);
  const last = clean(row.last_name);
  if (first && last) return `${first} ${last}`;
  const full = clean(row.full_name);
  return full || null;
}

function usable(row: CoachRow | null | undefined): row is CoachRow {
  if (!row) return false;
  if (row.archived) return false;
  const status = clean(row.status).toLowerCase();
  if (status === "archived" || status === "inactive" || status === "deactivated") return false;
  return !!legalNameOfCoach(row);
}

/**
 * Picks the coach the agreement names:
 *  1. the coach assigned to the client (the person who will coach them);
 *  2. otherwise the coach who sent the agreement;
 *  3. otherwise the owner, Jared McIntyre.
 */
export function resolveAgreementCoach(input: {
  assigned?: CoachRow | null;
  sender?: CoachRow | null;
}): AgreementCoach {
  if (usable(input.assigned)) {
    return {
      name: legalNameOfCoach(input.assigned)!,
      source: "assigned",
      coachId: input.assigned.id,
      userId: input.assigned.user_id ?? null,
    };
  }
  if (usable(input.sender)) {
    return {
      name: legalNameOfCoach(input.sender)!,
      source: "sender",
      coachId: input.sender.id,
      userId: input.sender.user_id ?? null,
    };
  }
  return { name: COACH.operator, source: "owner", coachId: null, userId: null };
}

const fill = (text: string, name: string) => text.split(COACH_TOKEN).join(name);

/**
 * The agreement with the coach's name filled in. Versions without the token (2.0, 2.1) come back
 * unchanged, so this is safe on any stored version.
 */
export function personalizeAgreement(
  content: AgreementContent,
  coachName: string | null | undefined,
): AgreementContent {
  const name = clean(coachName) || GENERIC_COACH_NAME;
  return {
    ...content,
    intro: content.intro.map((c) => ({ ...c, text: fill(c.text, name) })),
    keyTerms: content.keyTerms.map((k) => ({ ...k, text: fill(k.text, name) })),
    sections: content.sections.map((s) => ({
      ...s,
      inShort: fill(s.inShort, name),
      clauses: s.clauses.map((c) => ({ ...c, text: fill(c.text, name) })),
    })),
    acknowledgements: content.acknowledgements.map((a) => ({ ...a, text: fill(a.text, name) })),
  };
}
