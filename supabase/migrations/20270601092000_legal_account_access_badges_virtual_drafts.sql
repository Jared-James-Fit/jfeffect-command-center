-- Privacy Policy and Terms of Service: who at JF Effect can see an account and why, "View as"
-- (an administrator's or coach's audited, view-only-by-default look at the app as the person sees
-- it, with their own sign-in), membership badges in the community (and how to hide one), and the
-- disclosed virtual community accounts. Saved as DRAFTS with needs_legal_review = true for the
-- owner (and a lawyer) to read and publish in Admin → Legal; nothing is published here and no one
-- is asked to accept again by this migration (requires_reacceptance = false: whether the badge
-- disclosure needs a notice or re-acceptance is a decision for that review). Idempotent (skipped
-- once a version carries the new words); starts from the current published version.

DO $do$
DECLARE
  v_doc   uuid;
  v_base  public.legal_document_versions%ROWTYPE;
  v_next  integer;
  v_body  text;
  v_date  constant text := 'November 26, 2026';
  v_marker constant text := 'Who at JF Effect can see your account';
  v_privacy constant text := $section$Who at JF Effect can see your account
Authorized JF Effect administrators, and your coach if you are a coaching client, can see the information in your account when they need it for a legitimate purpose: running your account and membership, delivering coaching, technical support, managing your training, nutrition and progress, troubleshooting, billing and subscriptions, keeping the Service secure and preventing fraud, and correcting information when you ask us to or when it is wrong. A coach sees only the clients they coach.
To help you, an administrator or your coach may look at the app the way you see it ("View as"). They use their own sign-in: never your password, and never your full card number or your sign-in secrets, which we don't hold. Each view is opened for a stated reason, starts view-only, closes after 30 minutes without activity (4 hours at most), and is recorded: who opened it, when, why, which screens they opened and anything they changed. They can only change what they are already allowed to change, edits must be switched on for that view, and changing anything in a member's account also requires them to confirm their identity again.
We use this access only for the purposes above, never for marketing or anything unrelated, and agreeing to our Terms is not permission to use your information beyond what this policy describes. You can ask us who has accessed your account and why (see Your Rights).

Membership badges
In the community, a small badge beside your name shows whether you are a coaching client, a member or using the free app, based on your current plan. It never shows prices, payment details or anything about your health or training. You can hide it at any time in your profile's Privacy settings, and it updates on its own when your plan changes.

Virtual community accounts
JF Effect runs a small number of virtual accounts in the community. They are not real people, and each one is labelled "Virtual" wherever it appears, including in the list of who liked a post. They may like posts shared with the whole community. They never post, comment, follow or message anyone, and their likes don't send notifications. They see only what any community member can see, and they are left out of membership numbers, rankings and our analytics. Administrators manage them by hand; no photos or other media are used for them.
$section$;
  v_terms_marker constant text := 'Access to your account by JF Effect';
  v_terms constant text := $section$2.3 Access to your account by JF Effect
Authorized JF Effect administrators, and your coach if you are a coaching client, may access the information in your account for the purposes described in our Privacy Policy, such as account administration, coaching, support, troubleshooting, billing, security and authorized corrections. This includes viewing the app as you see it ("View as") with their own sign-in, for a stated reason, recorded each time. This section does not allow us to use your information for any other purpose.

2.4 Community badges and virtual accounts
Your community profile may show a badge for your current plan (coaching, member or free), which you can hide in your profile's Privacy settings. The community includes virtual accounts operated by JF Effect, each labelled "Virtual"; activity from a virtual account is not from a real person.
$section$;
BEGIN
  -------------------------------------------------------------------- Privacy Policy
  SELECT id INTO v_doc FROM public.legal_documents WHERE slug = 'privacy-policy';
  IF v_doc IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.legal_document_versions WHERE document_id = v_doc AND body LIKE '%' || v_marker || '%'
  ) THEN
    SELECT v.* INTO v_base
      FROM public.legal_document_versions v
      LEFT JOIN public.legal_documents d ON d.current_version_id = v.id
     WHERE v.document_id = v_doc
     ORDER BY (d.id IS NOT NULL) DESC, (v.status = 'published') DESC, v.version_number DESC
     LIMIT 1;
    IF v_base.id IS NOT NULL THEN
      v_body := v_base.body;
      -- before the providers section when it's there, else at the end
      IF position(E'\nService providers and AI processing' IN v_body) > 0 THEN
        v_body := replace(v_body, E'\nService providers and AI processing', E'\n' || v_privacy || E'\nService providers and AI processing');
      ELSE
        v_body := rtrim(v_body) || E'\n\n' || v_privacy;
      END IF;
      -- Your Rights: a line for the access record
      v_body := replace(
        v_body,
        E'Access the messages we hold about you, including copies of messages that were edited or deleted\n',
        E'Access the messages we hold about you, including copies of messages that were edited or deleted\nKnow who at JF Effect opened your account with "View as", when and why\n');
      IF v_body ~* 'Last updated:\s*[A-Za-z]+\s+[0-9]{1,2},\s*[0-9]{4}' THEN
        v_body := regexp_replace(v_body, 'Last updated:\s*[A-Za-z]+\s+[0-9]{1,2},\s*[0-9]{4}', 'Last updated: ' || v_date, 'i');
      END IF;
      SELECT coalesce(max(version_number), 0) + 1 INTO v_next FROM public.legal_document_versions WHERE document_id = v_doc;
      INSERT INTO public.legal_document_versions
        (document_id, version_number, status, title, summary, body, signature_method,
         requires_reacceptance, reacceptance_audience, effective_date, needs_legal_review, legal_review_note)
      VALUES
        (v_doc, v_next, 'draft', v_base.title,
         'Says who at JF Effect can see an account and why, how "View as" works (own sign-in, a stated reason, view-only by default, recorded), adds membership badges (and hiding them) and the labelled virtual community accounts, and a right to know who opened your account.',
         v_body, v_base.signature_method,
         false, v_base.reacceptance_audience, DATE '2026-11-26', true,
         'Written from the code on Nov 26 2026 (admin_pov_* sessions, _membership_badge, virtual_accounts). Needs professional review before publishing: (1) whether showing a plan badge to other members needs a notice or express consent under PIPEDA beyond the opt-out (it is on by default); (2) the virtual accounts disclosure (Competition Act and App Store guideline 1.1.6 on misleading features) and whether their likes may count in a post''s like total; (3) whether either change is material enough to ask for re-acceptance. Nothing here is published until the owner publishes it.');
    END IF;
  END IF;

  -------------------------------------------------------------------- Terms of Service
  v_doc := NULL;
  v_base := NULL;
  SELECT id INTO v_doc FROM public.legal_documents WHERE slug = 'terms-of-service';
  IF v_doc IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.legal_document_versions WHERE document_id = v_doc AND body LIKE '%' || v_terms_marker || '%'
  ) THEN
    SELECT v.* INTO v_base
      FROM public.legal_document_versions v
      LEFT JOIN public.legal_documents d ON d.current_version_id = v.id
     WHERE v.document_id = v_doc
     ORDER BY (d.id IS NOT NULL) DESC, (v.status = 'published') DESC, v.version_number DESC
     LIMIT 1;
    IF v_base.id IS NOT NULL THEN
      v_body := v_base.body;
      -- after section 2 (before the line that starts section 3), else at the end
      IF v_body ~ E'\n3\\. ' THEN
        v_body := regexp_replace(v_body, E'\n(3\\. )', E'\n' || v_terms || E'\n\\1');
      ELSIF position(E'\n3.1 ' IN v_body) > 0 THEN
        v_body := replace(v_body, E'\n3.1 ', E'\n' || v_terms || E'\n3.1 ');
      ELSE
        v_body := rtrim(v_body) || E'\n\n' || v_terms;
      END IF;
      IF v_body ~* 'Last updated:\s*[A-Za-z]+\s+[0-9]{1,2},\s*[0-9]{4}' THEN
        v_body := regexp_replace(v_body, 'Last updated:\s*[A-Za-z]+\s+[0-9]{1,2},\s*[0-9]{4}', 'Last updated: ' || v_date, 'i');
      END IF;
      SELECT coalesce(max(version_number), 0) + 1 INTO v_next FROM public.legal_document_versions WHERE document_id = v_doc;
      INSERT INTO public.legal_document_versions
        (document_id, version_number, status, title, summary, body, signature_method,
         requires_reacceptance, reacceptance_audience, effective_date, needs_legal_review, legal_review_note)
      VALUES
        (v_doc, v_next, 'draft', v_base.title,
         'Adds 2.3 Access to your account by JF Effect (purposes, "View as", recorded) and 2.4 Community badges and virtual accounts.',
         v_body, v_base.signature_method,
         false, v_base.reacceptance_audience, DATE '2026-11-26', true,
         'Pairs with the Privacy Policy draft of Nov 26 2026. Needs professional review before publishing, including whether re-acceptance is needed. Nothing here is published until the owner publishes it.');
    END IF;
  END IF;
END
$do$;
