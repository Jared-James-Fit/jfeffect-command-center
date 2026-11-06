// Shapes of the live-challenge database functions' JSON (20270205090000_live_challenges.sql).

export type ChallengeStatus =
  | "draft"
  | "upcoming"
  | "live"
  | "paused"
  | "verifying"
  | "completed"
  | "archived"
  | "cancelled";
export type Metric = "reps" | "weight" | "time" | "distance" | "points";
export type Unit = "reps" | "lb" | "kg" | "s" | "m" | "km" | "mi" | "pts" | "cal";
export type Direction = "higher" | "lower";
export type Scoring = "best" | "total" | "bodyweight_ratio";
export type Tiebreak = "shared" | "bodyweight_lower" | "fewer_attempts" | "next_best";
export type FieldMode = "off" | "optional" | "required";
export type StaffRole = "owner" | "manager" | "judge" | "registrar";
export type RegistrationState = "open" | "closed" | "full";

/** What's measured and how it's scored: enough to format any score. */
export interface ScoreSpec {
  metric: Metric;
  unit: Unit;
  direction: Direction;
  scoring: Scoring;
  load_value?: number | null;
  load_unit?: "lb" | "kg" | null;
}

export interface ChallengePublic extends ScoreSpec {
  id: string;
  slug: string;
  title: string;
  tagline: string | null;
  description: string | null;
  status: ChallengeStatus;
  activity: string;
  attempts_allowed: number;
  time_cap_seconds: number | null;
  objective: string | null;
  equipment: string | null;
  judging_standard: string | null;
  rules: string[];
  eligibility: string | null;
  safety: string | null;
  how_it_works: string | null;
  acknowledgments: string[];
  min_age: number;
  reg_fields: { phone?: FieldMode; instagram?: FieldMode };
  tiebreak: Tiebreak;
  tiebreak_note: string | null;
  starts_at: string | null;
  ends_at: string | null;
  timezone: string;
  registration_closes_at: string | null;
  location_name: string | null;
  location_address: string | null;
  city: string | null;
  max_participants: number | null;
  entry_fee: string;
  self_registration: boolean;
  registration_open: boolean;
  cover_path: string | null;
  published_at: string | null;
  final: boolean;
  finalized_at: string | null;
  is_template: boolean;
}

export interface HubCard extends ChallengePublic {
  registered: number;
  competed: number;
  registration: RegistrationState;
  prize: string | null;
  leader: { name: string; photo: string | null; score: number } | null;
}

export interface Division {
  id: string;
  name: string;
  description?: string | null;
}

export interface PublicPrize {
  id: string;
  place: number;
  division_id: string | null;
  title: string;
  description: string | null;
  sponsor: string | null;
}

export interface PublicSponsor {
  id: string;
  name: string;
  url: string | null;
  logo_path: string | null;
  blurb: string | null;
}

export interface Winner {
  place: number;
  division_id: string | null;
  prize: string;
  share: number;
  name: string;
  handle: string | null;
  photo: string | null;
  score: number;
  rank: number;
  division_rank: number;
}

export interface ChallengePageData {
  challenge: ChallengePublic;
  version: number;
  registration: RegistrationState;
  preview: boolean;
  divisions: Division[];
  prizes: PublicPrize[];
  sponsors: PublicSponsor[];
  updates: { id: string; body: string; at: string }[];
  counts: { registered: number; competed: number };
  winners: Winner[];
  viewer: {
    role: StaffRole | null;
    entry: { bib: number; handle: string; status: string; entry_id: string } | null;
  };
}

export interface PublicEntry {
  bib: number;
  name: string;
  handle: string | null;
  listed: boolean;
  photo: string | null;
  division_id: string | null;
}

export interface AttemptLite {
  n: number;
  v: number;
  r: "valid" | "no_lift";
  at?: string;
}

export interface BoardRow extends PublicEntry {
  rank: number;
  division_rank: number;
  tied: boolean;
  division_tied: boolean;
  score: number;
  best?: number | null;
  last_at?: string | null;
  attempts: AttemptLite[];
}

export interface BoardData {
  version: number;
  status: ChallengeStatus;
  final: boolean;
  rows: BoardRow[];
  recent: (PublicEntry & { value: number; result: "valid" | "no_lift"; attempt: number; at: string })[];
  now_up: (PublicEntry & { at: string }) | null;
  registered: number;
  updated_at: string;
}

export interface ResultData {
  challenge: ChallengePublic;
  version: number;
  athlete: PublicEntry & { instagram: string | null; is_me: boolean; claimed: boolean };
  division: string | null;
  status: string;
  rank: number | null;
  division_rank: number | null;
  tied: boolean;
  score: number | null;
  attempts: AttemptLite[];
  ranked: number;
  division_ranked: number;
  divisions: number;
  leader: { name: string; score: number } | null;
  above: { name: string; score: number; rank: number } | null;
  final: boolean;
  won: { prize: string; place: number; share: number }[];
  redirect?: string;
}

export interface ProfileHistoryItem extends ScoreSpec {
  slug: string;
  title: string;
  status: ChallengeStatus;
  starts_at: string;
  activity: string;
  city: string | null;
  final: boolean;
  bib: number;
  show_name: boolean;
  entry_status: string;
  division: string | null;
  rank: number | null;
  score: number | null;
  field: number;
  won: string[];
}

export interface AthleteProfile {
  handle: string;
  name: string;
  photo: string | null;
  instagram: string | null;
  listed: boolean;
  is_me: boolean;
  claimed: boolean;
  since: string;
  history: ProfileHistoryItem[];
  redirect?: string;
}

export interface ConsoleAttempt {
  id: string;
  n: number;
  v: number;
  r: "valid" | "no_lift";
  voided: boolean;
  void_reason: string | null;
  note: string | null;
  video: string | null;
  at: string;
}

export interface ConsoleEntry {
  entry_id: string;
  athlete_id: string;
  bib: number;
  name: string;
  handle: string;
  photo: string | null;
  show_name: boolean;
  division_id: string | null;
  status: "registered" | "checked_in" | "withdrawn" | "disqualified";
  status_reason: string | null;
  source: "staff" | "self";
  checked_in_at: string | null;
  bodyweight_kg: number | null;
  photo_consent: boolean;
  created_at: string;
  rank: number | null;
  division_rank: number | null;
  tied: boolean | null;
  score: number | null;
  final_rank: number | null;
  final_score: number | null;
  attempts: ConsoleAttempt[];
  contact: { full_name: string | null; email: string | null; phone: string | null; marketing: boolean; erased: boolean } | null;
  claimed: boolean;
}

export interface ConsoleData {
  challenge: ChallengePublic & { now_up_entry: string | null; now_up_at: string | null };
  role: StaffRole | null;
  contacts: boolean;
  version: number;
  divisions: Division[];
  entries: ConsoleEntry[];
}

/** The editable row as the owner / manager reads it from the table. */
export interface ChallengeRow extends Omit<ChallengePublic, "final" | "finalized_at"> {
  created_at: string;
  updated_at: string;
  created_by: string | null;
  copied_from: string | null;
  now_up_entry: string | null;
  results_finalized_at: string | null;
}

export interface AwardRow {
  id: string;
  prize_id: string;
  prize: string;
  place: number;
  division_id: string | null;
  value_cents: number | null;
  currency: string;
  share: number;
  status: "to_notify" | "notified" | "claimed" | "unclaimed" | "forfeited";
  notified_at: string | null;
  notified_via: string | null;
  claim_deadline: string | null;
  collection_instructions: string | null;
  claimed_at: string | null;
  notes: string | null;
  bib: number;
  name: string;
  handle: string;
  score: number;
  rank: number;
  full_name: string | null;
  email: string | null;
  phone: string | null;
}
