## Goal

Make finding the right program fast and personal across member library, admin/coach builder, and Goals & Setup, without touching program contents, assignment behaviour, or member access. Mobile-first.

## Reality check on data

- Member Program Library reads `member_plans` via `listMembershipLibrary` (fields: name, public_title, description, training_style, difficulty, weeks, days_per_week, est_minutes_per_workout, goal, featured, allow_full_program).
- Admin/coach builder reads `pl_templates` (name, template_type, training_style, training_focus, goal, weeks, days_per_week, est_duration_min, tags[], description, visibility, status).
- Neither table has explicit columns for: experience level, equipment list, training location, workout-length bucket. **But** `pl_templates.tags` already encodes most of that ("Beginner", "Glute Development", "Home Training", "5 Days/Week", "Female", "Powerlifting"…).
- Client Goals & Setup lives in `client_goals_setup` (29 cols) — used as the personalization input.

Decision: build a shared `lib/programs/facets.ts` that derives a normalized `ProgramFacets` from existing columns + tag parsing. No migration in phase 1. An optional metadata-editor pass (phase 6) can come later if you want to override derived facets.

## Phase 1 — Shared facet + recommendation engine

New `src/lib/programs/facets.ts`:
- `deriveFacets(program)` → `{ goals[], style, level, daysPerWeek, weeks, lengthMin, location, equipmentNeeded[], audienceTags[] }`
- Parses `tags[]` for level (Beginner/Novice/Intermediate/Advanced/Elite), goal hints (Glute Development → glutes, Hypertrophy → muscle, Strength/Powerlifting → strength, Fat Loss), location (Home Training → home, else gym), equipment, audience.
- Falls back to `training_style`, `training_focus`, `goal`, `difficulty`, `days_per_week`, `est_duration_min`.

New `src/lib/programs/categories.ts`:
- `CATEGORIES` constant (Recommended, Fat Loss, Build Muscle, Glute Focus, Strength, Powerlifting, Powerbuilding, Beginner, At Home, Short Workouts, All).
- `matchesCategory(facets, categoryId)` predicate per category.
- `GROUP_SECTIONS` for the "All Programs" grouped view (Beginner Foundations, Muscle Building, Glute Development, Powerbuilding, Powerlifting, Home Training, Advanced).

New `src/lib/programs/recommend.ts`:
- `scoreProgram(facets, goalsSetup)` returns `{ score, reasons[] }`.
- Weights: goal match 3, level match 2, days match 2, location/equipment match 2, length match 1.
- `rankRecommendations(programs, goalsSetup, n=5)` returns top N with non-empty reasons.

## Phase 2 — Member Program Library redesign (`/m/plans`)

Rewrite `src/routes/_authenticated/m/plans.tsx`:
- `TopPicksSection` at top — uses `rankRecommendations`. Shows the "Complete your Goals & Setup" empty-state CTA → `/m/goals-setup` (or current path) when profile incomplete.
- Horizontal scrollable `CategoryRail` with the 11 chips. Tap → filters in-place.
- Compact `FiltersButton` opens a `Sheet` (mobile) / `Popover` (desktop) with: goal, style, level, days/week, length, location, equipment, duration. Active filters render as removable chips. "Clear all", "Apply (N)" footer with live match count.
- Within "All Programs" category: grouped sections, each showing first 6 cards + "View all" that expands the section in-place.
- New `ProgramCard` component (`src/components/programs/program-card.tsx`):
  - Two-line title (`line-clamp-2`), responsive layout per `responsive-layout-patterns`.
  - Tag row (level, days, location, goal, length).
  - One-line description (`line-clamp-2`).
  - Preview / Add to My Training actions.
- Search bar persists. URL search params drive category + filters via `validateSearch` so back-button works.
- Lazy render: only first ~24 cards mount; "Load more" appends in batches of 24.

Bottom-nav safe-area: wrap page in `pb-24` like other `/m` routes.

## Phase 3 — Admin / coach workout builder selector

Touchpoints: `src/components/quick-assign-template-dialog.tsx`, `src/components/clients/assign-program-dialog.tsx`, and the template picker inside `src/routes/_authenticated/admin/program-library.tsx` / `program-assign.$clientId.tsx`.

- Extract a shared `<ProgramTemplatePicker clientId?={uuid} />` that reuses the same `CategoryRail`, `FiltersButton`, and grouped sections as the member library.
- Admin-only categories prepended: Recently used (from `pl_assignment_operations`), Most assigned (count from `pl_assignment_operations`), Recommended for this client (when `clientId` passed), My templates (owner=current user), Membership programs (link to `member_plans`).
- When `clientId` passed, fetch that client's `client_goals_setup`, run `rankRecommendations`, render a "Recommended for This Client" section with reason chips.
- Compatibility warnings (non-blocking) — banner inside Preview/Confirm step listing any of:
  - Days exceed client's available days.
  - Equipment not in client's profile.
  - Length exceeds client's preferred workout length.
  - Level mismatch with client's experience.

No change to assignment flow / writes.

## Phase 4 — Goals & Setup equipment simplification

Touchpoints: existing `client_goals_setup` form (locate in code), plus the API server fn that persists it.

- Replace the long equipment block with a conditional flow keyed on a new "Where will you train most often?" question persisted into a `training_location` field of the existing `setup` JSON (no schema change; `client_goals_setup` already stores structured answers).
- Branches as specified: Full commercial gym (auto-set; one yes/no follow-up), Powerlifting gym (auto staples + 4 extras), Small/apartment gym (short checklist), Home gym (grouped Main / Accessories with "Select more equipment" expander), Limited equipment (small list), Multiple locations (repeatable compact location profiles).
- Existing answers stay as-is; new flow only renders when the new `training_location` key is missing/empty OR the client clicks "Edit equipment".
- Preserve all existing fields in the payload so downstream code keeps working.

## Phase 5 — Profile summary collapse

Touchpoints: client profile equipment renderer (likely in `src/components/clients/client-quick-sheet.tsx` and admin client view).

- Replace per-equipment chip wall with a one-line `EquipmentSummary` ("Home gym: rack, barbell, bench & dumbbells" etc.) derived from the same `training_location` + equipment data.
- "View equipment details" button expands a `Collapsible` with the full list.
- Apply the same pattern to any other answer block that currently renders many chips.

## Phase 6 — Optional metadata editor (deferred, ask before starting)

If, after phase 1, you want overrides on derived facets, we add nullable columns to `pl_templates` (`primary_goal`, `experience_level`, `workout_length_min`, `location`, `equipment_required[]`, `equipment_optional[]`, `target_audience[]`) + an admin metadata sheet. Until then, `deriveFacets` is the source of truth.

## Non-goals / guarantees

- No changes to exercises, blocks, weeks, progression, assignments, completions, or member access.
- No automatic program assignment — Top Picks always require Preview + Add.
- No new notification or duplicate program records.
- Email/SMS untouched.

## Technical details

```text
src/lib/programs/
  facets.ts          # derive structured facets from member_plans / pl_templates row
  categories.ts      # category + section definitions, predicates
  recommend.ts       # scoreProgram, rankRecommendations
src/components/programs/
  program-card.tsx
  program-template-picker.tsx
  category-rail.tsx
  filters-sheet.tsx
  top-picks-section.tsx
  equipment-summary.tsx
```

Filter/category state lives in URL search params on `/m/plans` and `/admin/program-library` via `validateSearch` + `Route.useSearch()` + `useNavigate({ search })`. Lazy rendering uses a simple `visibleCount` state + IntersectionObserver sentinel.

## Sequence & checkpoints

1. Phase 1 (facets/categories/recommend) — pure TS, no UI yet. I'll ship and confirm.
2. Phase 2 (member library) — biggest visible change. Pause for your review on mobile before phase 3.
3. Phase 3 (builder selector).
4. Phase 4 (equipment flow).
5. Phase 5 (profile summary).
6. Phase 6 only if you ask.
