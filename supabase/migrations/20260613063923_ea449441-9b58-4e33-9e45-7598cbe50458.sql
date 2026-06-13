
-- Phase 4 — Legal Launch Gate: seed DRAFT legal documents + checkout placements.
-- Idempotent. No version is published. No acceptance is mutated.

DO $$
DECLARE
  v_terms_id   uuid;
  v_priv_id    uuid;
  v_ma_id      uuid;
  v_rbd_id     uuid;
  v_cancel_id  uuid;
BEGIN
  -- 1) Documents (one row per launch document). doc_type=custom for the
  --    membership-specific documents that don't have a dedicated enum value.
  INSERT INTO public.legal_documents (doc_type, slug, title, audience, is_required, public_read_allowed, archived)
  VALUES ('terms','terms-of-service','Terms of Service','everyone',true,false,false)
  ON CONFLICT (slug) DO NOTHING
  RETURNING id INTO v_terms_id;
  IF v_terms_id IS NULL THEN SELECT id INTO v_terms_id FROM public.legal_documents WHERE slug='terms-of-service'; END IF;

  INSERT INTO public.legal_documents (doc_type, slug, title, audience, is_required, public_read_allowed, archived)
  VALUES ('privacy','privacy-policy','Privacy Policy','everyone',true,false,false)
  ON CONFLICT (slug) DO NOTHING
  RETURNING id INTO v_priv_id;
  IF v_priv_id IS NULL THEN SELECT id INTO v_priv_id FROM public.legal_documents WHERE slug='privacy-policy'; END IF;

  INSERT INTO public.legal_documents (doc_type, slug, title, audience, is_required, public_read_allowed, archived)
  VALUES ('custom','membership-agreement','JF Membership Agreement','all_clients',true,false,false)
  ON CONFLICT (slug) DO NOTHING
  RETURNING id INTO v_ma_id;
  IF v_ma_id IS NULL THEN SELECT id INTO v_ma_id FROM public.legal_documents WHERE slug='membership-agreement'; END IF;

  INSERT INTO public.legal_documents (doc_type, slug, title, audience, is_required, public_read_allowed, archived)
  VALUES ('custom','recurring-billing-disclosure','Recurring Billing Disclosure','all_clients',true,false,false)
  ON CONFLICT (slug) DO NOTHING
  RETURNING id INTO v_rbd_id;
  IF v_rbd_id IS NULL THEN SELECT id INTO v_rbd_id FROM public.legal_documents WHERE slug='recurring-billing-disclosure'; END IF;

  INSERT INTO public.legal_documents (doc_type, slug, title, audience, is_required, public_read_allowed, archived)
  VALUES ('cancellation_policy','cancellation-and-refund-policy','Cancellation & Refund Policy','everyone',true,false,false)
  ON CONFLICT (slug) DO NOTHING
  RETURNING id INTO v_cancel_id;
  IF v_cancel_id IS NULL THEN SELECT id INTO v_cancel_id FROM public.legal_documents WHERE slug='cancellation-and-refund-policy'; END IF;

  -- 2) Draft version 1 for each document. needs_legal_review=true; status=draft.
  --    Body is a clearly-marked placeholder; admins must edit + publish.
  PERFORM 1 FROM public.legal_document_versions WHERE document_id = v_terms_id;
  IF NOT FOUND THEN
    INSERT INTO public.legal_document_versions (document_id, version_number, status, title, summary, body, signature_method, requires_reacceptance, needs_legal_review)
    VALUES (v_terms_id, 1, 'draft', 'Terms of Service',
            'Placeholder draft — replace with reviewed Terms before publishing.',
            E'[DRAFT — NOT LEGAL ADVICE]\n\nThis is a placeholder Terms of Service. Replace the body before publishing and confirm professional review during the publish step.',
            'checkbox', true, true);
  END IF;

  PERFORM 1 FROM public.legal_document_versions WHERE document_id = v_priv_id;
  IF NOT FOUND THEN
    INSERT INTO public.legal_document_versions (document_id, version_number, status, title, summary, body, signature_method, requires_reacceptance, needs_legal_review)
    VALUES (v_priv_id, 1, 'draft', 'Privacy Policy',
            'Placeholder draft — replace with reviewed Privacy Policy before publishing.',
            E'[DRAFT — NOT LEGAL ADVICE]\n\nThis is a placeholder Privacy Policy. Replace the body before publishing and confirm professional review during the publish step.',
            'checkbox', true, true);
  END IF;

  PERFORM 1 FROM public.legal_document_versions WHERE document_id = v_ma_id;
  IF NOT FOUND THEN
    INSERT INTO public.legal_document_versions (document_id, version_number, status, title, summary, body, signature_method, requires_reacceptance, needs_legal_review)
    VALUES (v_ma_id, 1, 'draft', 'JF Membership Agreement',
            'Placeholder draft — replace with reviewed Membership Agreement before publishing.',
            E'[DRAFT — NOT LEGAL ADVICE]\n\nThis is a placeholder Membership Agreement covering the JF Membership product, recurring billing, cancellation, refunds, content access, and acceptable use. Replace before publishing.',
            'checkbox', true, true);
  END IF;

  PERFORM 1 FROM public.legal_document_versions WHERE document_id = v_rbd_id;
  IF NOT FOUND THEN
    INSERT INTO public.legal_document_versions (document_id, version_number, status, title, summary, body, signature_method, requires_reacceptance, needs_legal_review)
    VALUES (v_rbd_id, 1, 'draft', 'Recurring Billing Disclosure',
            'Placeholder draft — replace with reviewed Recurring Billing Disclosure before publishing.',
            E'[DRAFT — NOT LEGAL ADVICE]\n\nMembership is $29 USD/month after a 3-day free trial. Billing recurs automatically each month until you cancel. Cancellation takes effect at the end of the current billing period. Taxes calculated at checkout where applicable.',
            'checkbox', true, true);
  END IF;

  PERFORM 1 FROM public.legal_document_versions WHERE document_id = v_cancel_id;
  IF NOT FOUND THEN
    INSERT INTO public.legal_document_versions (document_id, version_number, status, title, summary, body, signature_method, requires_reacceptance, needs_legal_review)
    VALUES (v_cancel_id, 1, 'draft', 'Cancellation & Refund Policy',
            'Placeholder draft — replace with reviewed Cancellation & Refund Policy before publishing.',
            E'[DRAFT — NOT LEGAL ADVICE]\n\nCancel anytime from your account. Cancellation takes effect at the end of your current billing period. Refunds follow the policy disclosed at checkout. Contact support for help.',
            'checkbox', true, true);
  END IF;

  -- 3) Membership checkout placements (one per required document).
  --    surface='custom' + context_key='membership_checkout' is the placement key.
  --    required=true so server validation insists on acceptance.
  --    active=false initially: the launch gate flips a placement live only when
  --    the document has a published version. The unique key prevents duplicates.
  INSERT INTO public.legal_document_placements (document_id, surface, required, context_key, display_order, active)
  VALUES
    (v_terms_id,  'custom', true, 'membership_checkout', 1, false),
    (v_priv_id,   'custom', true, 'membership_checkout', 2, false),
    (v_ma_id,     'custom', true, 'membership_checkout', 3, false),
    (v_rbd_id,    'custom', true, 'membership_checkout', 4, false),
    (v_cancel_id, 'custom', true, 'membership_checkout', 5, false)
  ON CONFLICT (document_id, surface, context_key) DO NOTHING;
END $$;

-- 4) Helper view for "currently required & published documents for membership checkout".
--    Used by the launch gate + server checkout validator. Read-only; admin-gated tables
--    behind it already enforce RLS. Recreate-able and additive.
CREATE OR REPLACE VIEW public.v_membership_checkout_legal AS
SELECT
  d.id                AS document_id,
  d.slug,
  d.title,
  d.doc_type,
  d.public_read_allowed,
  p.required,
  p.active            AS placement_active,
  v.id                AS current_version_id,
  v.version_number    AS current_version_number,
  v.status            AS current_version_status,
  v.needs_legal_review,
  v.published_at
FROM public.legal_documents d
JOIN public.legal_document_placements p
  ON p.document_id = d.id
 AND p.surface = 'custom'
 AND p.context_key = 'membership_checkout'
LEFT JOIN public.legal_document_versions v
  ON v.id = d.current_version_id
WHERE d.archived = false
  AND d.emergency_disabled = false
ORDER BY p.display_order;

GRANT SELECT ON public.v_membership_checkout_legal TO authenticated, service_role;

-- 5) Link acceptances to a checkout session (optional metadata column).
--    context_ref already exists; we'll also tag pending signups so we can
--    associate post-signup. Idempotent column add.
ALTER TABLE public.jf_pending_signups
  ADD COLUMN IF NOT EXISTS legal_acceptance_ids uuid[] NOT NULL DEFAULT '{}'::uuid[];
