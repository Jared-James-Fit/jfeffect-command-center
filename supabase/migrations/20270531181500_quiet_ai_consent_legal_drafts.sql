-- AI consent is recorded once at signup or in context, not on coaching agreement
-- signing. Preserve all existing choices and all legal acceptance requirements.
-- Drafts only: owner reviews and publishes the wording in Admin → Legal.
DO $do$
DECLARE
  v_doc record;
  v_base public.legal_document_versions%ROWTYPE;
  v_next integer;
  v_body text;
BEGIN
  FOR v_doc IN SELECT id, slug FROM public.legal_documents WHERE slug IN ('privacy-policy', 'terms-of-service') LOOP
    -- Prefer the newest version, so a pending legal edit is not lost.
    SELECT * INTO v_base FROM public.legal_document_versions
      WHERE document_id = v_doc.id ORDER BY version_number DESC LIMIT 1;
    IF v_base.id IS NULL THEN CONTINUE; END IF;
    v_body := replace(v_base.body, 'when you create your account or sign your coaching agreement', 'when you create your account');
    v_body := replace(v_body, 'when you create your account or sign the Coaching Agreement', 'when you create your account');
    IF v_body = v_base.body THEN CONTINUE; END IF;
    SELECT coalesce(max(version_number), 0) + 1 INTO v_next
      FROM public.legal_document_versions WHERE document_id = v_doc.id;
    INSERT INTO public.legal_document_versions
      (document_id, version_number, status, title, summary, body, signature_method,
       requires_reacceptance, reacceptance_audience, effective_date, needs_legal_review, legal_review_note)
    VALUES
      (v_doc.id, v_next, 'draft', v_base.title,
       'Clarifies that optional AI permission is not requested when signing the coaching agreement.',
       v_body, v_base.signature_method, false, v_base.reacceptance_audience,
       DATE '2026-11-26', true,
       'Existing AI permission choices remain in force. No expansion of processing scope or new obligation. Review before publishing; no reacceptance required for this wording-only change.');
  END LOOP;
END
$do$;
