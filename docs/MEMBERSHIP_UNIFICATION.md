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
2. **One program system — shipped.** "Start plan" (`/portal/plans`,
   `startLibraryPlan`) runs the coach's assign engine
   (`pl_assign_template_to_client`, which now also lets
   `member_can_start_plan` through: the member's own self-serve row, live
   access, a live published plan). The copy lands in `pl_blocks` the member
   owns (`created_by`), on the days they pick; starting another plan archives
   the one they started (history kept). The 40 plans' templates are linked
   to the library (6,596 → 48 unlinked rows; Glute Ham Raise, Lying Leg Curl
   and T-Bar Row have no honest match). `member_plans` stays the listing; its
   payload is only the preview. Members with no plan see "Pick your plan" on
   Home and Workouts.
3. **Retire `/m` duplicates — shipped.** `/m` is the redirect layout, an
   index and a catch-all (so every old link still lands in the portal) plus
   the Fillout completion landing. The member screens, the member workout
   adapter, the member start / log / complete / reschedule / enroll server
   functions and the components only they used are gone; live links that
   still pointed into `/m` go straight to the portal (members' recipe links
   were one). The member-only workout tables (`member_plan_enrollments`,
   `member_plan_day_schedule`, `member_set_logs`, `member_workout_completions`,
   `member_workout_reviews`, `member_exercise_swaps` / `_notes` /
   `_unit_prefs`) are read-only history: members keep SELECT, admin policies
   stay (exercise merges still re-point old rows), nothing deleted (3 old
   enrollments, 0 logged sets). Drop them in Phase 5 once this has run.
   Kept on purpose: member nutrition (`member_nutrition_targets`, meal logs,
   presets, supplements) is a live self-calculate feature, not a duplicate:
   coaching targets are coach-written in `nutrition_targets`.
4. **One builder.** One library, one assign path, publish-to-membership as a
   toggle (needs Jared's top-3 list).
5. **Delete list.** 4 "coming soon" membership admin pages, 5 redirect-only
   routes, duplicate settings pages, `admin/programs` stub, unreachable
   `coach/programs`, the unused `unified_workouts` flag, dead builder exports.
   From Phase 3: the unreachable member branches in shared workout code
   (`WorkoutDayView`, `QuickSwapButton`, `workout-completion.functions`,
   `deferred-exercise-actions`, `use-workout-heartbeat`, `member-swap.functions`),
   `home-bodyweight-card` (its bodyweight tests move to the portal card),
   `canRequestProgressReviewForMember`, `updateMyMarketingPrefs`,
   `listAdminLibrary`, and dropping the read-only member workout tables.
