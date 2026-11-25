-- Privacy Policy: "Service providers and AI processing" section, as a DRAFT for
-- the owner to read and publish in Admin → Legal (App Store guidelines 5.1.1(i)
-- and 5.1.2(i): the policy must name who receives personal data, including the
-- AI services, and how to withdraw permission). The published text lives in the
-- database, so this takes the current version's body, adds the section, sets
-- "Last updated" to November 25, 2026 and saves it as the next draft version.
-- Nothing is published and nobody is asked to re-accept anything until the
-- owner publishes it. Idempotent: skipped when any version already has the section.
-- Every statement below was checked against the code (src/lib/ai-consent/consent.ts,
-- src/lib/ai/routing.ts, voice-transcribe.functions.ts, pain/describe.server.ts,
-- cleo-attachments.server.ts, client-gcal.ts, google-cal.server.ts, drive/archive,
-- set-videos/server-copy.server.ts, stripe, sms-gateway.server.ts, email-sender).

DO $do$
DECLARE
  v_doc   uuid;
  v_base  public.legal_document_versions%ROWTYPE;
  v_next  integer;
  v_body  text;
  v_date  constant text := 'November 25, 2026';
  v_section constant text := $section$Service providers and AI processing
We use outside companies to run JF Effect. Each one receives only what it needs for the job described here.

AI services (OpenAI and Google)
Some features send what you enter, or what your coach is working from, to outside AI services. Nothing is sent until you allow it: the app asks you on a screen of its own, and again the first time you use a feature that needs it. If you don't allow it, those features stay off for you, your coach does that work by hand, and everything else works the same. We keep your answer, the wording you saw and when you gave it.
- OpenAI receives: the meal you describe for a meal estimate; programs and meal plans you import (the file or photo and its text); a pain description you type or say (the words, or the recording so it can be turned into text); and the training logs, check-ins, nutrition and health notes (including injuries and pain reports) your coach is working from when they prepare a draft, a plan or a brief. Cleo, your coach's assistant, also runs on OpenAI.
- Google (Gemini) receives: voice memos in your coach chat, to turn them into text; a spoken pain description, only when OpenAI's transcription can't read it; and PDFs or video clips your coach attaches to Cleo to be read. Google's service is reached through Lovable's AI gateway, which passes the request on.
- These providers may process this data outside Canada.
- To withdraw your permission, or give it later, open Account → Privacy & data → AI processing. It takes effect at once: from then on nothing new is sent. To ask about something sent earlier, contact us.

Other service providers
- Supabase stores our database, handles sign-in and keeps uploaded files: everything in your account.
- Stripe takes payments made on the website. It receives your name, email and what you bought; card details are entered on Stripe's pages and never reach us.
- Email is sent through Resend and Gmail, and text messages through Twilio, using your name, your email address or phone number, and the message itself.
- Google Calendar: our coaches' calendars hold the details of your sessions and calls, with a Google Meet link when there is one. If you connect your own Google Calendar, the app creates a calendar called "JF Effect" in your Google account and keeps your sessions, calls, workouts and events there. If you also allow read-only access, your other events are read when you look at your calendar in the app and are never stored.
- Google Drive: coaching clients' progress photos and videos, and set videos, are copied to JF Effect's Google Drive as a backup.
- Mux: when you share a film of a set, a private, short-lived link to the clip goes to Mux so it can make the copy shown in the feed. The copy is saved with us and removed from Mux.
- Vimeo plays some exercise and lesson videos, so it sees your device's address when one loads.
- Oura: only if you connect an Oura ring, we read your profile, daily summaries and heart rate from Oura.
- Push notifications reach your phone or browser through its own push service (Apple, Google or Mozilla).
- Lovable's platform carries the connections to Google, Resend, Gmail and Twilio, and the AI gateway above.
$section$;
BEGIN
  SELECT id INTO v_doc FROM public.legal_documents WHERE slug = 'privacy-policy';
  IF v_doc IS NULL THEN
    RETURN;
  END IF;

  -- already added (any version, draft or published)
  IF EXISTS (
    SELECT 1 FROM public.legal_document_versions
     WHERE document_id = v_doc AND body LIKE '%Service providers and AI processing%'
  ) THEN
    RETURN;
  END IF;

  -- start from what people read today: the current version, else the newest published, else the newest
  SELECT v.* INTO v_base
    FROM public.legal_document_versions v
    LEFT JOIN public.legal_documents d ON d.current_version_id = v.id
   WHERE v.document_id = v_doc
   ORDER BY (d.id IS NOT NULL) DESC, (v.status = 'published') DESC, v.version_number DESC
   LIMIT 1;
  IF v_base.id IS NULL THEN
    RETURN;
  END IF;

  SELECT coalesce(max(version_number), 0) + 1 INTO v_next
    FROM public.legal_document_versions WHERE document_id = v_doc;

  v_body := v_base.body;
  IF v_body ~* 'Last updated:\s*[A-Za-z]+\s+[0-9]{1,2},\s*[0-9]{4}' THEN
    v_body := regexp_replace(v_body, 'Last updated:\s*[A-Za-z]+\s+[0-9]{1,2},\s*[0-9]{4}', 'Last updated: ' || v_date, 'i');
  ELSE
    v_body := 'Last updated: ' || v_date || E'\n\n' || v_body;
  END IF;
  v_body := rtrim(v_body) || E'\n\n' || v_section;

  INSERT INTO public.legal_document_versions
    (document_id, version_number, status, title, summary, body, signature_method,
     requires_reacceptance, reacceptance_audience, effective_date, needs_legal_review, legal_review_note)
  VALUES
    (v_doc, v_next, 'draft', v_base.title,
     'Adds who receives personal data (OpenAI, Google, Stripe and the other service providers) and how to withdraw permission for AI processing.',
     v_body, v_base.signature_method,
     v_base.requires_reacceptance, v_base.reacceptance_audience, DATE '2026-11-25', true,
     'Adds "Service providers and AI processing", written from what the code does on Nov 25 2026. Check the provider list and where each processes data (readiness blocker 2), have counsel review, then publish. Update the Coaching Agreement''s AI-Assisted Coaching Disclosure to match.');
END
$do$;
