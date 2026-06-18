
## Phase 1 — Audit results

### What exists today
**Member experience (`/m/*`)**
- `src/routes/_authenticated/m/nutrition.tsx` — recipe browser with category chips, search, filters panel (Dietary / Goal / Prep / Difficulty), recipe preferences (dietary + restrictions stored on `app_members`), recommendation scoring from `goals_tags`. Has a thin "Your nutrition targets" card linking out to `/m/tools`.
- `src/routes/_authenticated/m/nutrition.$recipeId.tsx` — recipe detail (reuses `recipe-body-view`).
- `src/routes/_authenticated/m/tools.tsx` — generic resource list filtered by `kind="tool"`. NOT actual calculators — just links to admin-curated tool resources. No macro/calorie/water/sleep calculator components exist in code.

**Coaching client experience (`/portal/*`)**
- `src/routes/_authenticated/portal/nutrition-targets.tsx` — coach-assigned targets from `nutrition_targets` + `nutrition_target_days`, water string, cardio-by-day, optional PDF, FAQ widget, `NutritionUpdatePanel` (request update).
- `src/routes/_authenticated/portal/recipes.tsx` + `recipes.$recipeId.tsx` — separate recipe browser (different layout, fewer filters).

**Shared infra (already reusable)**
- `src/lib/recipes.ts` — `listRecipesForViewer()` works for both members and clients (RLS handles access).
- `src/lib/recipe-format.ts` — categories, `recipePreview`, parsing helpers.
- `src/components/recipe-body-view.tsx`, `meal-plan-display.tsx`, `nutrition-update-panel.tsx`, `nutrition-targets-panel.tsx` (coach view), `faq-widget.tsx`.

### Issues / duplication
1. **Two recipe browsers** (`m/nutrition.tsx` and `portal/recipes.tsx`) with different UX, filters, and routing — same data source.
2. **Targets fragmentation:** members have no targets surface (just a link to "tools" which has none); clients have a separate `/portal/nutrition-targets` page.
3. **"Open nutrition tools"** CTA points at a generic resource list — calculator features the spec mentions (macro/calorie/water/sleep) don't exist as actual calculators. Either auto-derived display from existing data or new lightweight components needed.
4. **Recipe cards** show raw markdown preview text (`recipePreview(r.body, 160)`) — looks unfinished. No image, prep time, servings, calories on card.
5. **Filter clutter** on `m/nutrition.tsx` — 4 filter groups always rendered when expanded; categories include `All Recipes` and full `RECIPE_CATEGORIES`.
6. **Hidden features:** `goals_tags`-driven recommendation scoring exists but is invisible to clients (only members use it). Cardio-by-day card is hidden from members. Water target only shows on client targets page.
7. **No grocery list / meal builder** in code — spec mentions them; treat as Phase-2 stubs unless data already lives somewhere (audit found nothing).

## Plan (minimal, reuse-first, no migrations)

### Step 1 — Create one shared Nutrition shell component
New `src/components/nutrition/NutritionDashboard.tsx` that takes `{ viewer: "member" | "client", clientId?, userId }` and renders:
- **Top: Targets strip** — Calories / Protein / Carbs / Fats / Water / Sleep cards, always visible. For clients: pull from `nutrition_targets` (existing query). For members: derived/auto values from `app_members` (use existing `goals_tags` + body data if present; otherwise show "—" with a "Set in goals" link). No new tables.
- **Quick actions grid (4 large mobile cards):** My Targets · Water & Recovery · Recipes · Nutrition FAQ. (Meal Builder + Grocery List = "Coming soon" tiles — no fake functionality.)
- **Inline recipe browser** below (shared component, see Step 2).

### Step 2 — One shared `RecipeBrowser` component
New `src/components/nutrition/RecipeBrowser.tsx`, extracted from current `m/nutrition.tsx`:
- Visible category chips: **Recommended, Breakfast, Lunch, Dinner, Snack, Meal Prep** (filter `RECIPE_CATEGORIES` to this set; "Recommended" only shows when prefs/goals available).
- Single **Filters** button → `Sheet` modal containing High Protein / Fat Loss / Muscle Gain / Vegan / Vegetarian / Omnivore / Quick / Performance. All currently-scattered Dietary/Goal/Prep/Difficulty groups collapse into one tag-matching list.
- Goal-based prioritization (Phase 8): keep existing `recommendationScore`; extend `goalTagMap` with `fat loss`, `maintenance`, `muscle gain`, `powerlifting`, `bodybuilding` keys; pull goal from `clients.goal` for clients and `app_members.goals_tags` for members.
- **New recipe card** (`RecipeCard`): image (if `r.image_url` exists), title, category badge, calories, protein, prep time, servings, tags. NO ingredient/markdown preview text. Need to check `recipes` columns for `image_url / calories / protein / prep_time / servings`; if missing, show only what's available (no schema changes).

### Step 3 — Wire both routes to the shared dashboard
- `m/nutrition.tsx` → renders `<NutritionDashboard viewer="member" />`.
- `portal/nutrition-targets.tsx` → renders `<NutritionDashboard viewer="client" clientId=… />` (keeps existing coach-assigned targets, day tabs, cardio-by-day, PDF card via the same component — pass extra blocks as children).
- `portal/recipes.tsx` becomes a thin route that just renders `<RecipeBrowser />` (or redirect to nutrition page — TBD with user).
- Keep route paths working; existing `/m/nutrition/$recipeId` and `/portal/recipes/$recipeId` detail routes untouched.

### Step 4 — Replace "Open nutrition tools" CTA
Remove the CTA at top of member nutrition page. Targets strip now visible directly. The `/m/tools` route is left alone (it's used by other resource categories).

### Step 5 — Mobile polish
- Targets strip: 3-col on mobile (`grid-cols-3 sm:grid-cols-6`).
- Quick action cards: 2-col on mobile, `min-h-[112px]`, large icons, large tap area.
- Category chips: horizontal scroll on mobile, `h-10` buttons.
- Filter sheet: full-height bottom sheet on mobile.
- No new container padding; reuse existing PageHeader.

### What this plan does NOT do
- No DB migrations, no new tables.
- No new recipe system, no new water/sleep tracking tables (unless the user confirms tracking is wanted — current code has no water/sleep tracking, only targets).
- No grocery list or meal builder logic — only placeholder tiles to surface the concept (the user can prioritize them in a follow-up).
- No edits to coach-side assignment UI (`nutrition-targets-panel.tsx`, dialogs, admin pages).
- No changes to auth, routing structure, or unrelated areas.

### Open questions before I build
1. **Calculators:** the spec lists macro/calorie/water/sleep calculators, but none exist in code. Do you want me to (a) build lightweight in-page calculators now, (b) auto-derive displayed targets from existing `app_members`/`clients` fields only, or (c) leave calculator tiles as "coming soon" and ship the consolidation first?
2. **Recipe card fields:** if the `recipes` table doesn't have `image_url`, `calories_per_serving`, `prep_time_minutes`, `servings`, do you want me to add those columns (one migration), or render only fields that exist today?
3. **Members targets:** members currently have NO target data at all. Should the member targets strip show (a) auto-calculated values from their goals/bodyweight, (b) blank with a "Calculate mine" button that runs a simple formula client-side, or (c) hide the strip entirely for members?
4. **`/portal/recipes` route:** keep it as a separate page that just renders the shared browser, or redirect it into the unified nutrition page?

Once you answer 1–4 I'll execute steps 1–5 in a single pass with no migrations and no parallel systems.
