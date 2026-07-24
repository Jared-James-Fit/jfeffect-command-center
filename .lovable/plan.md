## Performance Insights — plan

Adds an expandable **Performance Insights** section to the existing Training Analytics page. The current analytics stay untouched. Adaptive: powerlifters see comp-lift breakdowns first, bodybuilders see muscle-group volume first, hybrid athletes see both.

### Scope

**In**
- New collapsed card on `ClientAnalyticsDashboard` (client + coach analytics both consume it).
- Muscle-group volume grid (12 groups) with weekly / monthly / avg / tonnage / trend.
- Top Muscle Groups (Most Trained, Highest Tonnage, Biggest Growth, Most Consistent).
- Powerlifting block (S/B/D weekly volume, comp-lift tonnage, avg intensity, avg RPE, top sets, e1RM trend, variation breakdown).
- Time filter: Week / Month / Block / Year / All Time.
- Smart insights generator (data-driven, no generic strings).
- Share cards: portrait (story) + square (post), light + dark, "Save image" + Web Share API.
- Coach view: same data + adherence, volume compliance, missed volume, muscle-group balance.

**Out (not requested)**
- Client-vs-client comparisons over time (leaving as follow-up; note in code).
- Manual per-set muscle tagging UI. Uses existing `exercises.primary_muscle` / `secondary_muscles`.

### Data model — reuse only, no schema changes

- Volume + tonnage from `pl_row_results` joined to `pl_exercise_rows` → `exercises`.
- Muscle mapping from `exercises.primary_muscle` (1.0 weight) and `exercises.secondary_muscles` (0.5 weight per set).
- Powerlifting comp-lift detection: `exercises.category`/tags already in library (fallback to name match for Squat/Bench/Deadlift + common variations).
- Intensity / e1RM via `src/lib/analytics/e1rm.ts` (already unified).
- Adherence + missed volume from `pl_exercise_rows.sets` vs logged results (same math as `src/lib/workout-progress.ts`).

If `primary_muscle` is missing on some exercises, those rows are surfaced in a single "Uncategorized volume — tap to map" affordance rather than silently dropped.

### File layout

```text
src/lib/analytics/performance-insights.ts   // pure calculators + types
src/lib/analytics/muscle-map.ts             // exercise → muscle-group weights
src/lib/analytics/insight-generator.ts      // data-driven insight strings

src/components/analytics/performance-insights/
  index.tsx                       // collapsed shell + expanded orchestrator
  time-filter.tsx                 // Week/Month/Block/Year/All
  muscle-group-grid.tsx           // 12 cards + rings
  top-muscle-groups.tsx           // 4 highlight tiles
  powerlifting-panel.tsx          // S/B/D + variations + e1RM trend
  smart-insights.tsx              // list of generated insights, each with Share
  coach-extras.tsx                // adherence / compliance / balance (coach only)
  share-card.tsx                  // canvas renderer (portrait + square, dark/light)
  share-sheet.tsx                 // preview + Save / Share buttons
```

### UX

- Collapsed: single card titled **Performance Insights** with 3-stat teaser (Total Volume, Top Muscle, Trend) + "Explore" chevron. No layout shift on the main page.
- Expanded: time filter row → adaptive hero (PL panel or Muscle grid based on `client.training_focus`) → secondary section → Smart Insights → Coach Extras (coach only).
- Every muscle card + insight has a small `Share` icon → opens Share Sheet.
- Share sheet renders on an offscreen `<canvas>` via `html2canvas`-free approach (native Canvas 2D for reliability in Workers/edge preview). Provides:
  - Download PNG (`a[download]`)
  - `navigator.share({ files })` on mobile when supported, fallback to download.

### Adaptive logic

```ts
type Focus = "powerlifting" | "bodybuilding" | "hybrid" | "unknown";
// derive from client.training_focus + block.training_focus; if PL exercises
// dominate last 30d volume, treat as PL. Hybrid shows both hero panels.
```

### Time filter semantics

- **Week**: rolling 7 days.
- **Month**: rolling 30 days.
- **Block**: current `pl_blocks` window (start_date → today or end_date).
- **Year**: rolling 365 days.
- **All Time**: no lower bound.

Trend arrow compares selected window to the immediately-preceding equal window.

### Coach view

Same component tree with `variant="coach"` flag; renders `coach-extras.tsx` at the bottom. Client comparisons deferred (documented TODO in file).

### Non-goals / guardrails

- No changes to main workout page.
- No new tables, no migrations, no edge functions.
- No hardcoded colors — all tokens from `src/styles.css`.
- Share card uses branded gradient tokens; portrait 1080×1920, square 1080×1080.
- Everything memoized; heavy queries fetch once per filter change with TanStack Query.

### Technical notes

- Adds one dep: none required — native Canvas 2D for share cards.
- All new server-side reads reuse existing browser Supabase client patterns already used by `ClientAnalyticsDashboard`.
- Insight generator returns `{ id, icon, headline, subline, shareable: true, sharePayload }`; strings are built from numbers so nothing is generic.

### Rollout

Ship behind no flag — additive UI, collapsed by default, safe to release.
