-- AI processing is an optional, separate permission (src/lib/ai-consent), asked with an
-- unticked box when an account is made (/activate) or the Coaching Agreement is signed,
-- else once in the app where a feature first needs it, and managed in Account → Privacy
-- & data. The automatic "screen of its own" is gone. This saves the next version of the
-- Privacy Policy and of the Terms of Service to say so, as DRAFTS for the owner to read
-- and publish in Admin → Legal (publishing there confirms the wording was reviewed).
-- Neither asks anyone to accept again: the change adds an optional choice, no new
-- obligation (requires_reacceptance = false). Each step is idempotent (skipped once a
-- version carries the new words) and starts from what people read today: the current
-- version, else the newest published, else the newest.

DO $do$
DECLARE
  v_doc   uuid;
  v_base  public.legal_document_versions%ROWTYPE;
  v_next  integer;
  v_body  text;
  v_date  constant text := 'November 25, 2026';
  v_old_sentence constant text := 'Nothing is sent until you allow it: the app asks you on a screen of its own, and again the first time you use a feature that needs it.';
  v_new_sentence constant text := 'Nothing is sent until you allow it. You''re asked with a box that starts unticked when you create your account or sign your coaching agreement, or, if you haven''t answered, once in the app where a feature first needs it. Allowing it is optional and separate from agreeing to our Terms or this policy: it is never a condition of using JF Effect.';
  v_short_section constant text := $section$AI processing (optional)
Some features send what you enter, or what your coach is working from, to outside AI services (OpenAI and Google) so they can do their job: estimating a meal you describe, reading a program or meal plan you import, turning speech into text, and helping your coach prepare drafts, plans and briefs from your training, check-ins, nutrition and health notes. Nothing is sent until you allow it. You're asked with a box that starts unticked when you create your account or sign your coaching agreement, or, if you haven't answered, once in the app where a feature first needs it. Allowing it is optional and separate from agreeing to our Terms or this policy: it is never a condition of using JF Effect. If you don't allow it, those features stay off, your coach does that work by hand, and everything else works the same. These providers may process this data outside Canada. We keep your answer, the wording you saw and when you gave it. To withdraw your permission, or give it later, open Account → Privacy & data → AI processing; it takes effect at once.
$section$;
  v_consent_line constant text := 'Permission to send your information to AI services is also separate and optional, and is not a condition of the Service (see the AI processing section below).';
  v_terms_section constant text := $section$10.1 Optional AI features
Some optional features use outside AI services (OpenAI and Google) to work, such as estimating a meal you describe, reading a program or meal plan you import, turning speech into text, and helping your coach prepare drafts from your records. They are used only with your separate permission, which you can give with a box that starts unticked when you create your account or sign your coaching agreement, in the app the first time a feature needs it, or in Account → Privacy & data. Agreeing to these Terms is not that permission, and you don't need to give it to use the Service. You can withdraw it at any time; the features that need it then stay off and the rest of the Service works the same. AI output can be inaccurate, so check estimates and imported content before you rely on them. The Privacy Policy explains what is sent and to whom.
$section$;
BEGIN
  -------------------------------------------------------------------- Privacy Policy
  SELECT id INTO v_doc FROM public.legal_documents WHERE slug = 'privacy-policy';
  IF v_doc IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.legal_document_versions
     WHERE document_id = v_doc AND body LIKE '%it is never a condition of using JF Effect%'
  ) THEN
    SELECT v.* INTO v_base
      FROM public.legal_document_versions v
      LEFT JOIN public.legal_documents d ON d.current_version_id = v.id
     WHERE v.document_id = v_doc
     ORDER BY (d.id IS NOT NULL) DESC, (v.status = 'published') DESC, v.version_number DESC
     LIMIT 1;

    IF v_base.id IS NOT NULL THEN
      v_body := v_base.body;
      IF position(v_old_sentence IN v_body) > 0 THEN
        v_body := replace(v_body, v_old_sentence, v_new_sentence);
      ELSE
        v_body := rtrim(v_body) || E'\n\n' || v_short_section;
      END IF;
      -- the Consent section names it beside marketing consent, on the line after it, as that line is laid out
      v_body := regexp_replace(
        v_body,
        '(^|\n)([ \t]*(?:[-*•][ \t]*)?)(Marketing consent is handled separately where required, and is not a condition of receiving the core Service\.)',
        E'\\1\\2\\3\n\\2' || v_consent_line
      );
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
         'Says how permission for AI processing is asked (an unticked box when you create your account or sign your coaching agreement, else once in the app) and that it is optional and separate from agreeing to the Terms.',
         v_body, v_base.signature_method,
         false, v_base.reacceptance_audience, DATE '2026-11-25', true,
         'Replaces "the app asks you on a screen of its own" (that screen is gone) with how it is asked now, and adds a line under Consent. Written from the code on Nov 25 2026 (src/components/ai-consent/ai-consent.tsx). No one is asked to accept again. Read it, then publish.');
    END IF;
  END IF;

  -------------------------------------------------------------------- Terms of Service
  v_doc := NULL;
  v_base := NULL;
  SELECT id INTO v_doc FROM public.legal_documents WHERE slug = 'terms-of-service';
  IF v_doc IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.legal_document_versions
     WHERE document_id = v_doc AND body LIKE '%Optional AI features%'
  ) THEN
    SELECT v.* INTO v_base
      FROM public.legal_document_versions v
      LEFT JOIN public.legal_documents d ON d.current_version_id = v.id
     WHERE v.document_id = v_doc
     ORDER BY (d.id IS NOT NULL) DESC, (v.status = 'published') DESC, v.version_number DESC
     LIMIT 1;

    IF v_base.id IS NOT NULL THEN
      v_body := v_base.body;
      -- right after Third-Party Services when it's there, else at the end
      IF position('although we will use reasonable care in selecting and working with them.' IN v_body) > 0 THEN
        v_body := replace(
          v_body,
          'although we will use reasonable care in selecting and working with them.',
          'although we will use reasonable care in selecting and working with them.' || E'\n' || rtrim(v_terms_section, E'\n')
        );
      ELSE
        v_body := rtrim(v_body) || E'\n' || v_terms_section;
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
         'Adds 10.1 Optional AI features: AI processing is a separate, optional permission, not part of agreeing to these Terms, and can be withdrawn any time.',
         v_body, v_base.signature_method,
         false, v_base.reacceptance_audience, DATE '2026-11-25', true,
         'Adds section 10.1 after Third-Party Services. Written from the code on Nov 25 2026 (src/lib/ai-consent). Adds an optional choice and no new obligation, so no one is asked to accept again. Read it, then publish.');
    END IF;
  END IF;
END
$do$;
