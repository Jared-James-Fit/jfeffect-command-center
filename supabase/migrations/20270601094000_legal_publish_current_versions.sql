-- Publish the legal documents as the app works today (Nov 26 2026, at the owner's request in the
-- session that built account access, badges and virtual accounts).
--
-- What was waiting in Admin → Legal didn't add up to one current set:
--   * Terms of Service: the published v6 and the v7 / v8 drafts still describe the retired paid
--     membership ($29 USD a month after a 3-day trial, /m/billing, Keep Membership), while the
--     free-membership rewrite (draft v4, Nov 6) was never carried forward. The new version is v4's
--     free-membership wording with v8's additions: support@ addresses, 2.3 account access ("View
--     as"), 2.4 badges and virtual accounts, 8.1 Crew community guidelines; 10.1 AI is in both.
--   * Membership Agreement: draft v4 (the free membership) still said finished workouts post to
--     your Story automatically (nothing has since Nov 18) and carried the personal Gmail address.
--   * Cancellation & Refund Policy v4 and Recurring Billing Disclosure v3 said to cancel "in the
--     app (Account → Your plan)", which the iPhone app no longer opens (App Store 3.1.1, Nov 25):
--     they now say Account → Your plan at jfeffect.com.
--   * Privacy Policy v8 already holds v6 (published), v7 (account access, badges, virtual
--     accounts) and the headshots section: published as it is.
--
-- Each new version is built from its draft by exact replacements, each checked (a draft that no
-- longer reads as expected stops the whole migration, nothing half done). Published versions are
-- immutable and acceptance records keep pointing at the version each person accepted. Nobody is
-- asked to accept the Terms, Privacy Policy, Refund Policy or Billing Disclosure again; members
-- sign the Membership Agreement in the app as designed (from v3, IN_APP_SIGNING_FROM_VERSION).
-- Superseded drafts are archived, never deleted. Idempotent: a second run finds the published
-- versions (by their review notes, never the summaries readers see) and does nothing.

DO $legal$
DECLARE
  v_owner uuid;
  v_now   timestamptz := now();

  -- one guarded replacement: the old text must be there
  r_body  text;

  t_doc uuid; t_v4 text; t_v8 text; t_23 text; t_81 text; t_next int; t_id uuid;
  m_doc uuid; m_v4 public.legal_document_versions%ROWTYPE; m_next int; m_id uuid;
  f_doc uuid; f_v4 public.legal_document_versions%ROWTYPE; f_next int; f_id uuid;
  b_doc uuid; b_v3 public.legal_document_versions%ROWTYPE; b_next int; b_id uuid;
  p_doc uuid; p_v8 uuid;
BEGIN
  SELECT user_id INTO v_owner FROM public.business_owners ORDER BY created_at NULLS LAST LIMIT 1;

  ------------------------------------------------------------------ Terms of Service
  SELECT id INTO t_doc FROM public.legal_documents WHERE slug = 'terms-of-service';
  IF t_doc IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.legal_document_versions WHERE document_id = t_doc AND legal_review_note LIKE 'Built Nov 26 2026 from%') THEN
    SELECT body INTO t_v4 FROM public.legal_document_versions
     WHERE document_id = t_doc AND version_number = 4 AND md5(body) = '36020d706f175345e19cd28720e3f1a1';
    SELECT body INTO t_v8 FROM public.legal_document_versions
     WHERE document_id = t_doc AND version_number = 8 AND md5(body) = 'bd9cc9d591ce97d980b40297356fc4fb';
    IF t_v4 IS NULL OR t_v8 IS NULL THEN
      RAISE EXCEPTION 'terms: draft v4 or v8 changed since Nov 26 2026; publish by hand in Admin → Legal';
    END IF;
    -- the two blocks v8 added, taken from v8 itself
    t_23 := substring(t_v8 FROM position('2.3 Access to your account by JF Effect' IN t_v8)
                           FOR position(E'3. The Membership Service' IN t_v8) - position('2.3 Access to your account by JF Effect' IN t_v8));
    t_81 := substring(t_v8 FROM position('8.1 Crew community guidelines' IN t_v8)
                           FOR position(E'\n9. Intellectual Property' IN t_v8) - position('8.1 Crew community guidelines' IN t_v8));
    IF coalesce(length(t_23), 0) < 200 OR coalesce(length(t_81), 0) < 200 THEN
      RAISE EXCEPTION 'terms: could not read 2.3/2.4 or 8.1 from v8';
    END IF;

    r_body := t_v4;
    -- header
    IF position('Effective date: November 6, 2026    •    Last updated: November 6, 2026' IN r_body) = 0 THEN RAISE EXCEPTION 'terms: header'; END IF;
    r_body := replace(r_body, 'Effective date: November 6, 2026    •    Last updated: November 6, 2026',
                              'Effective date: November 26, 2026    •    Last updated: November 26, 2026');
    -- contact addresses (3 places)
    IF (length(r_body) - length(replace(r_body, 'jaredjamesfit@gmail.com', ''))) / length('jaredjamesfit@gmail.com') <> 3 THEN RAISE EXCEPTION 'terms: addresses'; END IF;
    r_body := replace(r_body, 'jaredjamesfit@gmail.com', 'support@jfeffect.com');
    -- 1.2: the billing disclosure applies to paid services too
    IF position('its own terms (such as the Coaching Agreement and the Cancellation & Refund Policy) also apply' IN r_body) = 0 THEN RAISE EXCEPTION 'terms: 1.2'; END IF;
    r_body := replace(r_body, 'its own terms (such as the Coaching Agreement and the Cancellation & Refund Policy) also apply',
                              'its own terms (such as the Coaching Agreement, the Cancellation & Refund Policy and the Recurring Billing Disclosure) also apply');
    -- 3: joining is by application (since Nov 19 2026)
    IF position('Access begins once you confirm your email address.' IN r_body) = 0 THEN RAISE EXCEPTION 'terms: 3'; END IF;
    r_body := replace(r_body, 'Access begins once you confirm your email address.',
                              'Joining is by application: access begins once your application is approved and your account is set up.');
    -- 4: paid extras exist now (AI credits, sold on the web)
    IF position('If we offer paid extras in the future, they will be optional and their price will be shown before you buy.' IN r_body) = 0 THEN RAISE EXCEPTION 'terms: 4'; END IF;
    r_body := replace(r_body, 'If we offer paid extras in the future, they will be optional and their price will be shown before you buy.',
                              'Optional paid extras, such as extra AI credits, show their price before you buy, and nothing is charged without your agreement.');
    -- 2.3 / 2.4 before section 3, 8.1 before section 9
    IF position(E'\n3. The Membership Service' IN r_body) = 0 OR position(E'\n9. Intellectual Property' IN r_body) = 0 THEN RAISE EXCEPTION 'terms: anchors'; END IF;
    r_body := replace(r_body, E'\n3. The Membership Service', E'\n' || rtrim(t_23, E'\n') || E'\n3. The Membership Service');
    r_body := replace(r_body, E'\n9. Intellectual Property', E'\n' || t_81 || E'\n9. Intellectual Property');
    IF r_body ~ '\$29|3-day trial|/m/billing|Keep Membership|gmail' THEN RAISE EXCEPTION 'terms: stale wording left'; END IF;

    SELECT coalesce(max(version_number), 0) + 1 INTO t_next FROM public.legal_document_versions WHERE document_id = t_doc;
    INSERT INTO public.legal_document_versions
      (document_id, version_number, status, title, summary, body, signature_method,
       requires_reacceptance, reacceptance_audience, effective_date, needs_legal_review, legal_review_note, created_by)
    SELECT t_doc, t_next, 'draft', v.title,
           'JF Effect is free and joining is by application. These Terms cover your account, who at JF Effect can see it and why, community badges and virtual accounts, the Crew community guidelines and optional AI features. Paid services such as coaching have their own terms.',
           r_body, v.signature_method, false, v.reacceptance_audience, DATE '2026-11-26', false,
           'Built Nov 26 2026 from draft v4 (free membership) and draft v8 (support@, 2.3/2.4, 8.1). Published at the owner''s request; still worth a lawyer''s read, especially 2.3/2.4 and 8.1.',
           v_owner
      FROM public.legal_document_versions v WHERE v.document_id = t_doc AND v.version_number = 8
    RETURNING id INTO t_id;
    UPDATE public.legal_document_versions SET status = 'published', needs_legal_review = false, published_by = v_owner, published_at = v_now
     WHERE id = t_id;
    UPDATE public.legal_document_versions SET status = 'archived'
     WHERE document_id = t_doc AND status = 'draft' AND id <> t_id;
  END IF;

  ------------------------------------------------------------------ JF Membership Agreement
  SELECT id INTO m_doc FROM public.legal_documents WHERE slug = 'membership-agreement';
  IF m_doc IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.legal_document_versions WHERE document_id = m_doc AND legal_review_note LIKE 'Built Nov 26 2026 from%') THEN
    SELECT * INTO m_v4 FROM public.legal_document_versions
     WHERE document_id = m_doc AND version_number = 4 AND md5(body) = 'eacf63b12531a07def698922d556c3b0';
    IF m_v4.id IS NULL THEN RAISE EXCEPTION 'membership: draft v4 changed since Nov 26 2026'; END IF;
    r_body := m_v4.body;
    IF position('Effective date: November 6, 2026    •    Last updated: November 6, 2026' IN r_body) = 0 THEN RAISE EXCEPTION 'membership: header'; END IF;
    r_body := replace(r_body, 'Effective date: November 6, 2026    •    Last updated: November 6, 2026',
                              'Effective date: November 26, 2026    •    Last updated: November 26, 2026');
    IF position('Version 4 replaces Version 2 (June 13, 2026).' IN r_body) = 0 THEN RAISE EXCEPTION 'membership: intro'; END IF;
    r_body := replace(r_body, 'Version 4 replaces Version 2 (June 13, 2026).', 'This version replaces Version 2 (June 13, 2026).');
    IF position(E'2. Who Can Join and Your Account\nYou must be at least' IN r_body) = 0 THEN RAISE EXCEPTION 'membership: 2'; END IF;
    r_body := replace(r_body, E'2. Who Can Join and Your Account\nYou must be at least',
                              E'2. Who Can Join and Your Account\nJoining is by application. You must be at least');
    IF position('- If we offer paid extras in the future, they will be optional, their price will be shown before you buy, and nothing will be charged without your agreement. Anything you buy will have its own terms.' IN r_body) = 0 THEN RAISE EXCEPTION 'membership: 3'; END IF;
    r_body := replace(r_body, '- If we offer paid extras in the future, they will be optional, their price will be shown before you buy, and nothing will be charged without your agreement. Anything you buy will have its own terms.',
                              '- Optional paid extras, such as extra AI credits, show their price before you buy, and nothing is charged without your agreement. Anything you buy has its own terms.');
    IF position('- Unless you switch off "Share my workouts" in your Crew settings, your finished workouts post to your Story and profile automatically. The Performance League shows' IN r_body) = 0 THEN RAISE EXCEPTION 'membership: 8'; END IF;
    r_body := replace(r_body, '- Unless you switch off "Share my workouts" in your Crew settings, your finished workouts post to your Story and profile automatically. The Performance League shows',
                              '- Nothing posts to Crew by itself: a post or story goes up only when you share it. The Performance League shows');
    IF position('- Some features use artificial intelligence to write summaries or suggestions. AI output can be wrong, so use your judgment.' IN r_body) = 0 THEN RAISE EXCEPTION 'membership: 10'; END IF;
    r_body := replace(r_body, '- Some features use artificial intelligence to write summaries or suggestions. AI output can be wrong, so use your judgment.',
                              '- Some optional features use outside AI services, only with your separate permission, as the Terms of Service and Privacy Policy explain. AI output can be wrong, so use your judgment.');
    IF position('jaredjamesfit@gmail.com' IN r_body) = 0 THEN RAISE EXCEPTION 'membership: contact'; END IF;
    r_body := replace(r_body, 'jaredjamesfit@gmail.com', 'support@jfeffect.com');
    IF r_body ~ '\$29|29 USD|gmail|Share my workouts' THEN RAISE EXCEPTION 'membership: stale wording left'; END IF;

    SELECT coalesce(max(version_number), 0) + 1 INTO m_next FROM public.legal_document_versions WHERE document_id = m_doc;
    INSERT INTO public.legal_document_versions
      (document_id, version_number, status, title, summary, body, signature_method,
       requires_reacceptance, reacceptance_audience, effective_date, needs_legal_review, legal_review_note, created_by)
    VALUES (m_doc, m_next, 'draft', m_v4.title,
            'JF Membership is free. This agreement covers what it includes, training on your own safely, the Crew rules, your content and the release of liability. Members accept it in the app.',
            r_body, m_v4.signature_method, true, m_v4.reacceptance_audience, DATE '2026-11-26', false,
            'Built Nov 26 2026 from draft v4 (Nov 6, free membership) with what changed since. Published at the owner''s request; the release and $100 liability cap are worth a lawyer''s read.',
            v_owner)
    RETURNING id INTO m_id;
    UPDATE public.legal_document_versions SET status = 'published', needs_legal_review = false, published_by = v_owner, published_at = v_now
     WHERE id = m_id;
    UPDATE public.legal_document_versions SET status = 'archived'
     WHERE document_id = m_doc AND status = 'draft' AND id <> m_id;
  END IF;

  ------------------------------------------------------------------ Cancellation & Refund Policy
  SELECT id INTO f_doc FROM public.legal_documents WHERE slug = 'cancellation-and-refund-policy';
  IF f_doc IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.legal_document_versions WHERE document_id = f_doc AND legal_review_note LIKE 'Built Nov 26 2026 from%') THEN
    SELECT * INTO f_v4 FROM public.legal_document_versions
     WHERE document_id = f_doc AND version_number = 4 AND md5(body) = '3cbbb1406a552e39b56eb31778898933';
    IF f_v4.id IS NULL THEN RAISE EXCEPTION 'refund: draft v4 changed since Nov 26 2026'; END IF;
    r_body := f_v4.body;
    IF position('You can cancel yourself in the app (Account → Your plan), or by email' IN r_body) = 0 THEN RAISE EXCEPTION 'refund: 2'; END IF;
    r_body := replace(r_body, 'You can cancel yourself in the app (Account → Your plan), or by email', 'You can cancel yourself in Account → Your plan at jfeffect.com, or by email');
    IF position('You can move between monthly plans in the app.' IN r_body) = 0 THEN RAISE EXCEPTION 'refund: 3a'; END IF;
    r_body := replace(r_body, 'You can move between monthly plans in the app.', 'You can move between monthly plans in Account → Your plan at jfeffect.com.');
    IF position('Before you confirm a change, the app shows' IN r_body) = 0 THEN RAISE EXCEPTION 'refund: 3b'; END IF;
    r_body := replace(r_body, 'Before you confirm a change, the app shows', 'Before you confirm a change, Your plan shows');
    IF position('Plans are changed in the app. Stripe''s billing page, opened from the app, is for' IN r_body) = 0 THEN RAISE EXCEPTION 'refund: 3c'; END IF;
    r_body := replace(r_body, 'Plans are changed in the app. Stripe''s billing page, opened from the app, is for', 'Plans are changed in Your plan. Stripe''s billing page, opened from there, is for');
    IF position('You can update your card in the app (Account → Your plan).' IN r_body) = 0 THEN RAISE EXCEPTION 'refund: 8'; END IF;
    r_body := replace(r_body, 'You can update your card in the app (Account → Your plan).', 'You can update your card in Account → Your plan at jfeffect.com.');
    IF position('Cancellations: in the app, or coaching@jfeffect.com.' IN r_body) = 0 THEN RAISE EXCEPTION 'refund: 11'; END IF;
    r_body := replace(r_body, 'Cancellations: in the app, or coaching@jfeffect.com.', 'Cancellations: Account → Your plan at jfeffect.com, or coaching@jfeffect.com.');

    SELECT coalesce(max(version_number), 0) + 1 INTO f_next FROM public.legal_document_versions WHERE document_id = f_doc;
    INSERT INTO public.legal_document_versions
      (document_id, version_number, status, title, summary, body, signature_method,
       requires_reacceptance, reacceptance_audience, effective_date, needs_legal_review, legal_review_note, created_by)
    VALUES (f_doc, f_next, 'draft', f_v4.title,
            'How to cancel or change a coaching plan (Account → Your plan at jfeffect.com, or by email), when changes take effect, special prices, and how refunds work.',
            r_body, f_v4.signature_method, false, f_v4.reacceptance_audience, DATE '2026-11-26', false,
            'Built Nov 26 2026 from draft v4 (Nov 24, matching Coaching Agreement 3.0), pointing plan changes at jfeffect.com since the iPhone app no longer opens Your plan. Published at the owner''s request.',
            v_owner)
    RETURNING id INTO f_id;
    UPDATE public.legal_document_versions SET status = 'published', needs_legal_review = false, published_by = v_owner, published_at = v_now
     WHERE id = f_id;
    UPDATE public.legal_document_versions SET status = 'archived'
     WHERE document_id = f_doc AND status = 'draft' AND id <> f_id;
  END IF;

  ------------------------------------------------------------------ Recurring Billing Disclosure
  SELECT id INTO b_doc FROM public.legal_documents WHERE slug = 'recurring-billing-disclosure';
  IF b_doc IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.legal_document_versions WHERE document_id = b_doc AND legal_review_note LIKE 'Built Nov 26 2026 from%') THEN
    SELECT * INTO b_v3 FROM public.legal_document_versions
     WHERE document_id = b_doc AND version_number = 3 AND md5(body) = '5d98adf6c6217d5ad3ecad9d462897fb';
    IF b_v3.id IS NULL THEN RAISE EXCEPTION 'billing: draft v3 changed since Nov 26 2026'; END IF;
    r_body := b_v3.body;
    IF position('Cancel any time before your next billing date in the app (Account → Your plan) or by email' IN r_body) = 0 THEN RAISE EXCEPTION 'billing: 4'; END IF;
    r_body := replace(r_body, 'Cancel any time before your next billing date in the app (Account → Your plan) or by email', 'Cancel any time before your next billing date in Account → Your plan at jfeffect.com, or by email');
    IF position('The app shows the amounts and dates before you confirm.' IN r_body) = 0 THEN RAISE EXCEPTION 'billing: 3'; END IF;
    r_body := replace(r_body, 'The app shows the amounts and dates before you confirm.', 'Your plan shows the amounts and dates before you confirm.');
    IF position('Receipts are emailed by Stripe and are in the app. You can update your card and billing details from Account → Your plan.' IN r_body) = 0 THEN RAISE EXCEPTION 'billing: 5'; END IF;
    r_body := replace(r_body, 'Receipts are emailed by Stripe and are in the app. You can update your card and billing details from Account → Your plan.',
                              'Receipts are emailed by Stripe and are in My Purchases at jfeffect.com. You can update your card and billing details from Account → Your plan at jfeffect.com.');
    IF position('Update your card in the app to keep your plan.' IN r_body) = 0 THEN RAISE EXCEPTION 'billing: 6'; END IF;
    r_body := replace(r_body, 'Update your card in the app to keep your plan.', 'Update your card in Account → Your plan at jfeffect.com to keep your plan.');

    SELECT coalesce(max(version_number), 0) + 1 INTO b_next FROM public.legal_document_versions WHERE document_id = b_doc;
    INSERT INTO public.legal_document_versions
      (document_id, version_number, status, title, summary, body, signature_method,
       requires_reacceptance, reacceptance_audience, effective_date, needs_legal_review, legal_review_note, created_by)
    VALUES (b_doc, b_next, 'draft', b_v3.title,
            'How coaching packages are billed each month in CAD plus tax, how plan changes and cancellations work, and where to find your receipts.',
            r_body, b_v3.signature_method, false, b_v3.reacceptance_audience, DATE '2026-11-26', false,
            'Built Nov 26 2026 from draft v3 (Nov 24), pointing plan changes at jfeffect.com since the iPhone app no longer opens Your plan. Published at the owner''s request.',
            v_owner)
    RETURNING id INTO b_id;
    UPDATE public.legal_document_versions SET status = 'published', needs_legal_review = false, published_by = v_owner, published_at = v_now
     WHERE id = b_id;
    UPDATE public.legal_document_versions SET status = 'archived'
     WHERE document_id = b_doc AND status = 'draft' AND id <> b_id;
  END IF;

  ------------------------------------------------------------------ Privacy Policy (v8 as written)
  SELECT id INTO p_doc FROM public.legal_documents WHERE slug = 'privacy-policy';
  SELECT v.id INTO p_v8 FROM public.legal_document_versions v
   WHERE v.document_id = p_doc AND v.version_number = 8 AND v.status = 'draft'
     AND md5(v.body) = 'b147b2a7df1304f1cdef41bd4ae15907';
  IF p_v8 IS NOT NULL THEN
    UPDATE public.legal_document_versions SET status = 'published', needs_legal_review = false, published_by = v_owner, published_at = v_now,
           legal_review_note = coalesce(legal_review_note, '') || ' Published Nov 26 2026 at the owner''s request.',
           summary = 'What we collect and why, who at JF Effect can see your account, how account headshots work, membership badges and virtual community accounts, AI processing (only with your permission), and your rights.'
     WHERE id = p_v8;
    UPDATE public.legal_document_versions SET status = 'archived'
     WHERE document_id = p_doc AND status = 'draft' AND id <> p_v8;
  END IF;
END
$legal$;
