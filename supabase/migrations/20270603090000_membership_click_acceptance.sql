-- Change only the membership acceptance mechanism. Never rewrite a published version
-- or fabricate a new acceptance for existing members. The app recognizes valid v6
-- evidence for this specific method-only revision, without stamping a v7 signature.
DO $click$
DECLARE
  d public.legal_documents%ROWTYPE;
  v public.legal_document_versions%ROWTYPE;
  new_id constant uuid := 'a3b82fe0-06e8-4d27-9c64-7b04567e71d2';
  old_clause constant text := 'You accept this Agreement electronically in the app by ticking the confirmation boxes and typing your name.';
  new_clause constant text := 'You accept this Agreement electronically while signed in to your account by ticking all required confirmation boxes and selecting Agree & continue.';
  new_body text;
  owner_id uuid;
BEGIN
  SELECT * INTO d FROM public.legal_documents WHERE slug = 'membership-agreement' FOR UPDATE;
  IF NOT FOUND OR d.current_version_id IS NULL THEN
    RAISE EXCEPTION 'Membership agreement has no published version.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.legal_document_versions WHERE id = new_id AND document_id = d.id AND published_at IS NOT NULL) THEN
    RETURN;
  END IF;
  SELECT * INTO v FROM public.legal_document_versions WHERE id = d.current_version_id;
  IF v.version_number <> 6 OR v.status <> 'published' OR v.signature_method <> 'typed_name'
    OR md5(v.body) <> '5a1bbaebd891efd402a22f42ca04c5a8'
    OR position(old_clause IN v.body) = 0
    OR EXISTS (SELECT 1 FROM public.legal_document_versions WHERE document_id = d.id AND version_number >= 7)
  THEN
    RAISE EXCEPTION 'Membership agreement changed; review current text before switching acceptance methods.';
  END IF;
  new_body := replace(v.body, old_clause, new_clause);
  SELECT user_id INTO owner_id FROM public.business_owners ORDER BY created_at NULLS LAST LIMIT 1;
  INSERT INTO public.legal_document_versions
    (id, document_id, version_number, status, title, summary, body, signature_method,
     requires_reacceptance, reacceptance_audience, effective_date, needs_legal_review,
     legal_review_note, created_by)
  VALUES (new_id, d.id, 7, 'draft', v.title, v.summary, new_body,
          'checkbox', false, v.reacceptance_audience, CURRENT_DATE, false,
          'Owner requested method-only change from typed name to authenticated checkbox acceptance. Existing v6 evidence remains valid; no new acceptance is fabricated. Legal review recommended.',
          owner_id);
  UPDATE public.legal_document_versions SET status = 'published', published_at = now(), published_by = owner_id
    WHERE id = new_id;
  IF NOT EXISTS (SELECT 1 FROM public.legal_documents WHERE id = d.id AND current_version_id = new_id) THEN
    RAISE EXCEPTION 'Membership agreement publication failed.';
  END IF;
END $click$;
