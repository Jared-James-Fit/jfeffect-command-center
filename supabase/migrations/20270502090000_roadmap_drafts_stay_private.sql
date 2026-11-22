-- A coach's roadmap draft stays the coach's until it's approved, even after a newer draft replaces it.
--
-- The first policy let an athlete read their own revisions that were 'active' or 'superseded',
-- reading "superseded" as "was in effect once". A draft the coach never approved is superseded too
-- when a newer draft replaces it, so on Nov 22 2026 Colten could read his first-run draft (a −225 kcal
-- proposal his coach never saw through). Activation is the only way to 'active' and it always stamps
-- decided_at; a draft superseded while still waiting never has one.
--
-- Same access otherwise: an athlete's own decisions (self-coached), what's in effect, and what was in
-- effect before. The client view's history applies the same rule in code (view.ts athleteSees) for a
-- coach previewing as the client, who reads with his own login.
SET lock_timeout = '8s';

DROP POLICY IF EXISTS "Athletes read own nutrition roadmap revisions" ON public.nutrition_roadmap_revisions;
CREATE POLICY "Athletes read own nutrition roadmap revisions" ON public.nutrition_roadmap_revisions
  FOR SELECT TO authenticated
  USING (
    client_id IN (SELECT c.id FROM public.clients c WHERE c.user_id = (SELECT auth.uid()))
    AND (decider = 'athlete' OR status = 'active' OR (status = 'superseded' AND decided_at IS NOT NULL))
  );

-- The roadmap row (status, the coach-facing decision, the next check-in) is the coach's working state:
-- for a coached athlete it can name a change the coach hasn't approved. Their screens read it on the
-- server (roadmap.server.ts myRoadmapView, after the caller's identity is checked) and show only what's
-- approved, so a coached athlete reads no row directly; a self-coached member's roadmap is their own.
DROP POLICY IF EXISTS "Athletes read own nutrition roadmap" ON public.nutrition_roadmaps;
CREATE POLICY "Athletes read own nutrition roadmap" ON public.nutrition_roadmaps
  FOR SELECT TO authenticated
  USING (client_id IN (SELECT c.id FROM public.clients c WHERE c.user_id = (SELECT auth.uid()) AND c.service_tier = 'self_serve'));
