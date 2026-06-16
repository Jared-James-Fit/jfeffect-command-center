This is a large request that touches the admin program library, the admin recipe library, the member recipe/nutrition experience, recipe access/RLS, and the member bottom navigation. I'm going to lay out the plan in phases so we can ship and verify each piece before moving to the next, rather than landing 10 sweeping changes in one drop.

I'd recommend approving phase by phase. I can do them in order, but trying to do all of it in one turn would be risky for a system with this much live data (programs, recipes, member access, RLS).

---

## Phase 1 — Investigate & confirm before any destructive change

Before I touch anything, I'll:

1. Read the current admin program library (`admin/program-library.tsx`, 1530 lines) and capture how templates, drafts, archives, membership vs coaching, and metadata are stored today (table: `pl_templates`, plus `pl_template_shares`, `member_plans`).
2. Read `admin/recipes.tsx`, `m/nutrition.tsx`, `m/nutrition.$recipeId.tsx`, and the `recipes` / `recipe_client_access` / `recipe_notifications` tables — and find out **why member-facing recipes are missing**. Likely causes: missing GRANT to `authenticated`, an RLS policy requiring a row in `recipe_client_access` that was never inserted, or a `status != 'published'` filter on the member query. I'll confirm with a direct DB read.
3. Audit `m/resources.tsx` + `resources.$slug.tsx` + the `resources` / `member_resources` / `resource_*` tables and every link in the codebase that points at `/m/resources`, onboarding emails, notification templates, etc. Output: a short list of what (if anything) needs to be migrated before Resources can be removed.

Deliverable of this phase: a short written summary in chat (no code yet) of: recipe bug root cause, what Resources currently contains, and any sharp edges (e.g. a notification that deep-links into `/m/resources/...`).

## Phase 2 — Fix the broken member recipe access (highest priority)

This is the "members can't see recipes" bug and should ship first, independent of any UI redesign.

- Apply whatever the root cause turns out to be (likely: add a migration that grants `SELECT` to `authenticated` and adds/loosens an RLS policy like `published = true AND visibility = 'membership'`, OR backfill missing `recipe_client_access` rows for published membership recipes).
- Confirm via a logged-in member query that previously-created published recipes now return.
- No UI changes in this phase — purely data/access correctness.

## Phase 3 — Member "Nutrition & Recipes" page + bottom nav

- Rename `m/nutrition.tsx` heading and page title to **Nutrition & Recipes** everywhere it's referenced.
- Update the member bottom-nav item currently labeled "Resources" to **Nutrition** with a nutrition icon, pointing at `/m/nutrition`. Keep the same nav slot — no new tab.
- Inside Nutrition & Recipes, lay out:
  - Nutrition targets card (if assigned to this member — read from `nutrition_targets`)
  - **Recommended for You** strip (Phase 4 fills it in; ship a stub first)
  - Category chips (Recommended, Breakfast, Lunch, …, All Recipes)
  - Compact filter panel (Calories / Protein / Carbs / Fat / Meal type / Goal / Prep time / Dietary preference / Food restrictions / Difficulty), with active filters shown as removable chips
  - Recipe grid using a slimmed-down card (name, photo, category, calories, protein, prep time, short description, tags, View / Save)
  - Saved recipes section
- Pagination or "load more" — never load every recipe at once.

## Phase 4 — Personalized recipe recommendations

- Read the member's `client_goals_setup` (goal, nutrition preference, food restrictions, biggest challenge).
- Server function that returns 3–5 recipes matched by goal/preference, **filtered to exclude anything that conflicts with food restrictions** (safety filter — hard exclude, not just deprioritize).
- If `client_goals_setup` is incomplete, render the "Complete your Goals & Setup to get personalized nutrition recommendations" CTA instead.
- Each recommendation shows a short reason chip ("High protein", "Matches your nutrition goal", etc.).

## Phase 5 — Remove the Resources page safely

Only after Phase 1 confirms nothing critical depends on it:

- Delete `m/resources.tsx` and `m/resources.$slug.tsx`.
- Remove the nav entry (already replaced in Phase 3).
- Remove dead imports / dead components / dead server fns that were only used by Resources.
- Leave shared tables and storage buckets alone if any other feature still touches them.
- Migrate anything Phase 1 surfaced (nutrition→Nutrition & Recipes, workout→Training, exercise education→Exercise Library, agreements→Agreements, account info→Account).

## Phase 6 — Admin Program Library reorganization

Rebuild `admin/program-library.tsx` UI (no schema change to programs):

- Section chips: Recently edited, Drafts, Published, Membership, Coaching, Beginner, Bodybuilding, Glute focused, Powerbuilding, Powerlifting, At home, Archived.
- Compact filter panel: Goal / Training style / Experience level / Days per week / Workout length / Gym or home / Equipment / Duration / Draft or published / Membership or coaching / Active or archived.
- Toolbar: Search, Sort, Clear filters, result count, **Create new program**.
- Pagination / lazy loading (server-side via TanStack Query `useInfiniteQuery` against `pl_templates`).
- Card shows: full name (no truncation), category, goal, experience level, days/week, duration, gym/home, draft/published, membership/coaching, last updated.
- Card actions: Open, Edit, Duplicate, Preview as member, Publish/Unpublish, Archive.
- Add an **Edit metadata** dialog so the admin can update category/goal/tags/access without rebuilding blocks/weeks/exercises.

## Phase 7 — Admin Recipe Library reorganization

Inside the nutrition area (new route: `admin/nutrition.recipes.tsx` or keep `admin/recipes.tsx` and restructure):

- Sections: Recently edited, Drafts, Published, Membership, Coaching-only, Archived.
- Toolbar: Search, Filters, Sort, Create recipe, Duplicate, Preview as member, Publish/Unpublish, Archive.
- Card shows: name, category, calories, protein, goal tags, dietary tags, draft/published, membership/coaching, last updated.
- Confirm required metadata exists on the `recipes` table: meal category, goal, calories, protein, carbs, fat, prep time, difficulty, dietary tags, food restriction tags, membership availability, published status. If any column is missing, add it via migration (no destructive changes to existing recipes).

---

## Technical notes

- **Data layer**: all reads via TanStack Query + `createServerFn`. Member-side reads use `requireSupabaseAuth` so RLS scopes per user. Admin-side reads use `requireSupabaseAuth` + role check (`has_role(auth.uid(), 'admin')`).
- **No bulk loads**: program library and recipe library both use cursor-based pagination (~24 per page).
- **Food restrictions are a safety filter**, not a ranking signal — implemented as a hard `NOT EXISTS` against the member's restriction tags.
- **No schema drops, no recipe/program data rewrites.** Any new columns will be added with safe defaults. Any RLS changes will be additive (allow members to read published membership recipes), never broadening access to coaching-only content.
- **Mobile-first**: all new layouts tested at 375px so cards/buttons aren't clipped by the bottom nav.

---

## What I need from you

1. **Approval to proceed phase by phase** (preferred), or tell me to bundle phases.
2. Confirm priority — if Phase 2 (recipes not showing up for members) is the most painful right now, I'll ship that first and pause for you to verify before moving to UI.
3. Anything in the existing Resources page you already know we must preserve? If you can name it now it'll save me a round trip during Phase 1.
