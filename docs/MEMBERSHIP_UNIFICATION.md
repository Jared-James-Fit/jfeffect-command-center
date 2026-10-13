# Membership + Coaching Unification

Spec for moving self-serve members onto the same engine as coaching clients.
Source: "Membership + Coaching Unification Plan" (Oct 13, 2026), with every
claim checked against the code and the live database on Oct 13, 2026.

## Verdict

Members share the **engine** with clients (one athlete record, one program
system, one history) and get a different **service layer**. What separates
coaching from self-serve is the human part: a coach programming, reviewing
and replying. Entitlements decide the service, not separate tables.

## What the live data says (Oct 13, 2026)

| | Count |
|---|---|
| `app_members` rows | 19 |
| …coaching clients (`program_only`, linked to a client) | 17 |
| …admin sandbox (`app_member`, `is_admin_sandbox`) | 1 |
| …real self-serve members (`jf_member`) | 1, cancelled in June, archived |
| Published membership plans (`member_plans`) | 40 |
| Plan starts (`member_plan_enrollments`) | 3, all from that one member, 0 workouts done |
| `member_set_logs`, `member_workout_completions` | 0 |
| Other `member_*` data (bodyweight, nutrition, meals, swaps, notes, reviews) | 0 |
| Coaching history at stake (`pl_row_results` / `pl_day_completions`) | 10,664 sets / 770 workouts |

**Consequence:** there is no member training history to migrate. Phase 2
("migrate enrollments and logs, dry run first") becomes "point the product at
`pl_*` and retire the member tables": no data move, no risk to anyone's
history. The plan's riskiest phase is now its simplest.

## Bugs confirmed

1. **Members who cancel lost access immediately; comped members were locked
   out.** Billing writes "Active (Cancels at period end)" and
   "Complimentary", but the checks only accepted active / trialing (in
   `memberAccess.ts` and in the SQL `member_can_consume` /
   `jf_member_has_full_access`). **Fixed (Phase 0).**
2. **Member plans showed no reps or names.** The builder publishes
   `reps_text` / `load_lb` / `exercise_name_override`; the member adapter read
   `reps` / `load` / `exercise`, so plans showed blank reps and
   "Exercise 1, 2, 3". Confirmed on a real published plan. **Fixed
   (Phase 0)**, because signup is live and a new member would hit it.
   Separate finding: the 40 published plans name their exercises in free text
   with no `exercise_id`, so members get no demo videos, cues or exercise
   history. Phase 2 has to link them to the library.
3. **Editing a program could wipe a client's history.** Deleting a row, day,
   week or block cascades to `pl_row_results` and `pl_day_completions`. Paths
   that did it: the block editor's save (removed items are deleted), "Copy
   week" / "Copy day" (replaced the target days), "Clear future weeks",
   "Delete program", "Unassign". **Fixed (Phase 0):** database guard plus
   editors that keep logged parts (see AGENTS.md).

## Decisions

| Question | Answer |
|---|---|
| How many paying members, and have they logged? | None today (see table). Phase 2 needs no data migration. |
| "Hold Plan" members: full access or restricted? | Restricted, as built: the Hold Plan banner already says "Full membership features are locked while on the Hold Plan", and billing treats it as $9 to keep the account and data. Cancel-at-period-end keeps access until the date. |
| Crew: open to members, or a coaching-only perk? | **Open to members** (Jared, Oct 13). More people posting makes the feed alive, and members see coaching clients' wins every day. |
| What's slowest when building a plan? | All four (Jared, Oct 13): too many places (library pages, three assign paths), assigning to a client takes too many steps, finding exercises, progressions across weeks. Phase 4 fixes them in that order. |
| Go ahead with Phases 1–3? | **Yes** (Jared, Oct 13). |

## Service tiers

| Both tiers (the tools) | Coaching only (the service) |
|---|---|
| Workout logging, PRs, analytics, history | Custom programming, edited by a coach |
| Exercise library and demo videos | Coach chat, lift video review |
| Nutrition tools, recipes, progress, bodyweight | Check-ins and weekly reviews |
| Library plans | Training Intel, pain flags, coach notes |
| Support inbox (to the team) | Coach-written roadmap, agreements, PT sessions |

Upgrading becomes: flip the tier, assign a coach. Their full training history
comes with them, so the coach starts with real data.

## Member self-built plans (after Phase 2)

From "Member Self-Built Plans" (Oct 13, 2026): a light version on the same
engine, never a copy of the coach builder. The edge is programming
expertise; a membership that's "a blank builder" puts JF Effect in a fight
with Hevy and Strong.

1. **Customize before create.** Swap exercises (exists), change days per
   week, add a set, on a library plan before it starts.
2. **"Log any workout."** A blank session filled in as they go (catches
   off-plan training).
3. **"Build my own plan," lite.** Days, library exercises, sets, reps, RPE;
   saved as a `pl_block` the member owns, so logging, PRs and history work
   with no new code paths. Only if members turn out to be experienced lifters.

Guardrails: library exercises only (no free-typed names); coach-built
programs stay locked (a coaching client can't edit what their coach wrote:
editing is decided by who owns the block, never by tier alone); one
coach-review prompt after week 3 or 4, which could be a one-time paid review
between membership and full coaching.

Open: are members mostly beginners following plans, or lifters who know how
to train? Beginners → stop at steps 1–2. Experienced → step 3. Unknowable
until there are members; ship 1–2 first.

## Phases (each its own PR, verified before the next)

0. **Hotfixes — shipped.** Access for cancel-at-period-end and comped
   members; logged training can't be deleted by program edits; member plans
   show names / reps / loads.
1. **Unified identity.** `clients.service_tier` (`self_serve` | `coaching`),
   a `clients` row for every member (no coach assigned); everyone lands in
   `/portal`; one `useEntitlement(key)` gates coach-service screens; a tier
   filter on the admin client list so members don't flood coaching views.
2. **One program system.** A "membership library" flag on templates; "Start
   plan" runs the existing assign function (copies into `pl_blocks`). Link
   the 40 plans' exercises to the library. No enrollments to migrate.
3. **Retire `/m` duplicates.** Member tables are empty, so: read-only, then
   drop once Phase 2 is verified.
4. **One builder.** One library, one assign path, publish-to-membership as a
   toggle (needs Jared's top-3 list).
5. **Delete list.** 4 "coming soon" membership admin pages, 5 redirect-only
   routes, duplicate settings pages, `admin/programs` stub, unreachable
   `coach/programs`, the unused `unified_workouts` flag, dead builder exports.
