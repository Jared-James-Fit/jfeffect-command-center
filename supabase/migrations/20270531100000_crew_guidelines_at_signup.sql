-- Crew community guidelines are agreed to once, with the Terms, never mid-comment (Nov 26 2026).
--
-- 20270527109000_crew_ugc_safety.sql refused a person's first Crew post or comment until they
-- tapped "I agree" on a Community rules sheet (HINT = 'crew_rules'). In production that put the
-- sheet in front of 15 of the 17 people who had posted or commented in 60 days, the moment they
-- tried to comment. The guidelines now ride on the account's own agreement:
--
--   1. Posting and commenting are never refused for a missing rules acceptance. A suspension
--      (HINT = 'crew_suspended'), the word filter, reports, blocks and moderation are unchanged.
--   2. Agreeing to the Terms of Service (sign-up's box, which now names the Crew community
--      guidelines, or the Legal & Safety centre for an existing account) is also recorded in
--      community_rules_acceptances, so that table stays the one place that says who agreed
--      to the guidelines and when. Existing rows are never changed or removed.
--   3. The Terms of Service gain "8.1 Crew community guidelines" (zero tolerance, report and
--      block, the 24-hour review, the contact), saved as a DRAFT for the owner to read and
--      publish in Admin → Legal, like every Terms change. When another Terms draft is already
--      waiting (Nov 26's 2.3 Access to your account), this one is built on it, so there is one
--      draft to publish with both. It adds no obligation the Terms
--      don't already make (6. Acceptable Use, 8. User Content and Community), so nobody is
--      asked to accept again (requires_reacceptance = false).
--
-- Idempotent: functions are replaced, the trigger dropped and made again, the backfill and the
-- draft skip what's already there.

-- 1 ------------------------------------------------------------------------------------------
-- Same signature, so every guard trigger keeps calling it; `_need_rules` is accepted and ignored.
CREATE OR REPLACE FUNCTION public.crew_assert_can_post(_uid uuid, _need_rules boolean)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_until timestamptz := public.crew_posting_paused_until(_uid);
BEGIN
  IF v_until IS NOT NULL THEN
    RAISE EXCEPTION USING
      MESSAGE = 'Posting in Crew is paused on your account until ' || to_char(v_until AT TIME ZONE 'America/Winnipeg', 'FMMon FMDD') || '.',
      ERRCODE = '42501', HINT = 'crew_suspended';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.crew_assert_can_post(uuid, boolean) FROM PUBLIC, anon, authenticated;

-- 2 ------------------------------------------------------------------------------------------
/** Accepting the Terms of Service is also agreeing to the Crew community guidelines (part of them). */
CREATE OR REPLACE FUNCTION public.tg_legal_acceptance_crew_guidelines()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.revoked_at IS NULL
     AND EXISTS (SELECT 1 FROM public.legal_documents d WHERE d.id = NEW.document_id AND d.slug = 'terms-of-service') THEN
    INSERT INTO public.community_rules_acceptances (user_id, version, accepted_at)
    VALUES (NEW.user_id, public.crew_rules_version(), coalesce(NEW.accepted_at, now()))
    ON CONFLICT (user_id) DO UPDATE
      SET version = EXCLUDED.version, accepted_at = EXCLUDED.accepted_at
      WHERE public.community_rules_acceptances.version < EXCLUDED.version;
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.tg_legal_acceptance_crew_guidelines() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_legal_acceptance_crew_guidelines ON public.legal_acceptances;
CREATE TRIGGER trg_legal_acceptance_crew_guidelines
  AFTER INSERT ON public.legal_acceptances
  FOR EACH ROW EXECUTE FUNCTION public.tg_legal_acceptance_crew_guidelines();

-- the Terms already accepted count too (never over a row that's there)
INSERT INTO public.community_rules_acceptances (user_id, version, accepted_at)
SELECT la.user_id, public.crew_rules_version(), min(la.accepted_at)
  FROM public.legal_acceptances la
  JOIN public.legal_documents d ON d.id = la.document_id AND d.slug = 'terms-of-service'
 WHERE la.revoked_at IS NULL
 GROUP BY la.user_id
ON CONFLICT (user_id) DO NOTHING;

-- 3 ------------------------------------------------------------------------------------------
DO $do$
DECLARE
  v_doc   uuid;
  v_base  public.legal_document_versions%ROWTYPE;
  v_next  integer;
  v_body  text;
  v_current integer;
  v_on_draft boolean;
  v_date  constant text := 'November 26, 2026';
  v_section constant text := $section$8.1 Crew community guidelines
Crew is where members train and cheer each other on. These guidelines are part of these Terms, and you agree to them when you agree to these Terms:
Zero tolerance: no hate, slurs, harassment, bullying, threats, sexual content, or anything that encourages self-harm. Ever.
No abusive users: targeting or abusing someone can get your posting paused or your account removed.
Report and block: use ⋯ on any post, story, comment or profile to report it or block the person. The JF Effect team reviews every report within 24 hours and removes content that breaks these guidelines.
Your posts, your responsibility: only share what you have the right to share. Words that break these guidelines can't be posted.
The guidelines are always in the app (Account → Community guidelines) and at https://jfeffect.com/community-guidelines. Questions, or something urgent: support@jfeffect.com.
$section$;
BEGIN
  SELECT id INTO v_doc FROM public.legal_documents WHERE slug = 'terms-of-service';
  IF v_doc IS NULL OR EXISTS (
    SELECT 1 FROM public.legal_document_versions
     WHERE document_id = v_doc AND body LIKE '%8.1 Crew community guidelines%'
  ) THEN
    RETURN;
  END IF;

  -- from a draft already waiting on top of what people read today (so ONE draft carries every
  -- pending change, e.g. 20270601092000's 2.3 Access to your account), else what people read
  -- today: the current version, else the newest published, else the newest
  SELECT coalesce(cv.version_number, 0) INTO v_current
    FROM public.legal_documents d
    LEFT JOIN public.legal_document_versions cv ON cv.id = d.current_version_id
   WHERE d.id = v_doc;
  SELECT v.* INTO v_base
    FROM public.legal_document_versions v
    LEFT JOIN public.legal_documents d ON d.current_version_id = v.id
   WHERE v.document_id = v_doc
   ORDER BY (v.status = 'draft' AND v.version_number > coalesce(v_current, 0)) DESC,
            (d.id IS NOT NULL) DESC, (v.status = 'published') DESC, v.version_number DESC
   LIMIT 1;
  IF v_base.id IS NULL THEN RETURN; END IF;
  v_on_draft := v_base.status = 'draft';

  v_body := v_base.body;
  -- at the end of section 8, just before 9. Intellectual Property; else at the end
  IF position(E'\n9. Intellectual Property' IN v_body) > 0 THEN
    v_body := replace(v_body, E'\n9. Intellectual Property', E'\n' || rtrim(v_section, E'\n') || E'\n9. Intellectual Property');
  ELSE
    v_body := rtrim(v_body) || E'\n' || v_section;
  END IF;
  IF v_body ~* 'Last updated:\s*[A-Za-z]+\s+[0-9]{1,2},\s*[0-9]{4}' THEN
    v_body := regexp_replace(v_body, 'Last updated:\s*[A-Za-z]+\s+[0-9]{1,2},\s*[0-9]{4}', 'Last updated: ' || v_date, 'i');
  ELSE
    v_body := 'Last updated: ' || v_date || E'\n\n' || v_body;
  END IF;

  SELECT coalesce(max(version_number), 0) + 1 INTO v_next
    FROM public.legal_document_versions WHERE document_id = v_doc;

  INSERT INTO public.legal_document_versions
    (document_id, version_number, status, title, summary, body, signature_method,
     requires_reacceptance, reacceptance_audience, effective_date, needs_legal_review, legal_review_note)
  VALUES
    (v_doc, v_next, 'draft', v_base.title,
     'Adds 8.1 Crew community guidelines: zero tolerance for hate, harassment, threats and sexual content, Report and Block, the 24-hour review and the contact. Agreed to with these Terms, never on a separate screen in Crew.',
     v_body, v_base.signature_method,
     false, v_base.reacceptance_audience, DATE '2026-11-26', true,
     'Adds section 8.1 at the end of 8. User Content and Community, in the words the app shows (src/lib/crew-safety.ts, CREW_RULES). Sign-up''s box now reads "I agree to the JF Effect Terms of Service, including the Crew community guidelines, and the Privacy Policy." Nothing new is asked of anyone the Terms don''t already ask (6. Acceptable Use), so no one is asked to accept again.'
       || CASE WHEN v_on_draft
               THEN ' Built on draft version ' || v_base.version_number || ', so it carries that draft''s changes too: publish this one instead of version ' || v_base.version_number || '.'
               ELSE '' END
       || ' Read it, then publish.');
END
$do$;
