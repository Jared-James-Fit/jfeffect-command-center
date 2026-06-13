## Multi-Block Program Templates — Plan

### Scope reality check
This request spans the data model, builder UI, assignment, client progression, undo/redo, trash, permissions, and full QA across 24 sections. Honestly: this is **multi-day work** (10+ migrations, a builder refactor, assignment flow rewrite, client progression rewrite). Trying to ship all 24 sections in one turn will produce shallow, half-wired surfaces — exactly the failure mode prior audits flagged.

I want to confirm the approach before I touch anything.

### Current architecture (quick audit)
- `pl_templates` — program template header (single block today)
- `pl_blocks` — the block itself, also doubles as the client-assigned instance
- `pl_weeks` → `pl_days` → `pl_exercise_rows` → `pl_row_results`
- `pl_bulk_operations` — existing undo log (reusable)
- Builder lives in `src/components/program-builder.tsx` + `src/routes/_authenticated/admin/program-library_.$templateId.tsx`
- A "template" today = one block. There is no parent→many-blocks relationship in templates.

### Proposed phased delivery (each phase is shippable and tested before the next)

**Phase 1 — Data model + Block selector (foundation)**
- Migration: add `pl_template_blocks` join (template_id, block_id, sort_order, archived_at, trashed_at) OR add `template_id` + `sort_order` + `archived_at` + `trashed_at` directly to `pl_blocks` (whichever fits existing FKs cleanest — I'll verify in the audit).
- Backfill: every existing template gets one block linked at sort_order=0.
- Builder header gets a Block tab strip + `?block=<id>` URL persistence.
- Add Block (blank + duplicate current).
- Switch blocks preserves week/day/mode params and autosave.

**Phase 2 — Block lifecycle**
- Rename, reorder (drag + buttons), archive/restore, trash/restore, permanent delete with history-guard.
- Wire all of it into existing `pl_bulk_operations` so global Undo/Redo (Cmd+Z) covers block ops.
- Atomic server fns with operation IDs.

**Phase 3 — Program overview + Copy Block to another Program**
- Overview card (blocks / weeks / days / est. duration).
- Copy block across templates.
- Validation warnings (empty block, empty week, etc.).

**Phase 4 — Multi-block assignment + client progression**
- Assign entire program | selected blocks | start from block N.
- Client view shows current/upcoming/completed blocks.
- Manual activate-next, skip, reorder on the client copy.

**Phase 5 — Full QA pass**
- 1/2/4/10+ blocks, empty, archived, trashed, long names, refresh, back/forward, mobile/tablet/desktop, autosave, regression of existing Week/Day/Full Screen/bulk ops.

### Question for you
Do you want me to:

**A)** Ship Phase 1 this turn (data model + selector + add/switch/URL), fully working and regression-tested, then continue phases in follow-up turns. **Recommended** — each phase lands solid.

**B)** Attempt all 5 phases this turn and accept that several surfaces (assignment, client progression, redo, validation, full QA matrix) will land partially wired and likely need follow-up fixes.

**C)** A different sequence you specify.

I won't start writing migrations or code until you pick.
