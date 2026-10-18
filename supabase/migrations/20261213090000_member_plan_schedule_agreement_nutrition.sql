-- JF members: one training schedule, saved nutrition targets that always
-- save, and Membership Agreement v3 ready to publish.

-- 1) Suggested targets: one ACTIVE row per member. The old UNIQUE (member_id,
--    active) also allowed only one INACTIVE row, so a member's third save
--    failed ("Could not save targets") and the screen kept the old numbers.
ALTER TABLE public.member_nutrition_targets
  DROP CONSTRAINT IF EXISTS member_nutrition_targets_member_id_active_key;
-- keep the newest active row if any member somehow has two
UPDATE public.member_nutrition_targets t SET active = false
 WHERE t.active
   AND EXISTS (SELECT 1 FROM public.member_nutrition_targets n
                WHERE n.member_id = t.member_id AND n.active AND n.created_at > t.created_at);
CREATE UNIQUE INDEX IF NOT EXISTS member_nutrition_targets_one_active
  ON public.member_nutrition_targets (member_id) WHERE active;

-- 2) Committed training days live on clients (the calendar, the plan start and
--    every reminder read them). The member setup wizard also keeps a copy on
--    app_members (setup completeness); mirror every change onto it so the two
--    can't disagree. The app writes clients and realigns the workouts.
CREATE OR REPLACE FUNCTION public.clients_sync_committed_days_to_member()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.user_id IS NULL OR coalesce(array_length(NEW.committed_training_days, 1), 0) = 0 THEN
    RETURN NULL;
  END IF;
  BEGIN
    UPDATE public.app_members m
       SET committed_training_days = NEW.committed_training_days,
           committed_training_frequency = coalesce(NEW.committed_training_frequency, array_length(NEW.committed_training_days, 1))
     WHERE m.user_id = NEW.user_id
       AND (m.committed_training_days IS DISTINCT FROM NEW.committed_training_days
            OR m.committed_training_frequency IS DISTINCT FROM coalesce(NEW.committed_training_frequency, array_length(NEW.committed_training_days, 1)));
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'clients_sync_committed_days_to_member: %', SQLERRM;
  END;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.clients_sync_committed_days_to_member() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS clients_sync_committed_days_to_member ON public.clients;
CREATE TRIGGER clients_sync_committed_days_to_member
  AFTER INSERT OR UPDATE OF committed_training_days, committed_training_frequency ON public.clients
  FOR EACH ROW EXECUTE FUNCTION public.clients_sync_committed_days_to_member();

-- backfill: a member who only answered the setup wizard gets those days as
-- their schedule; everyone else's wizard copy is brought up to date
UPDATE public.clients c
   SET committed_training_days = m.committed_training_days,
       committed_training_frequency = coalesce(m.committed_training_frequency, array_length(m.committed_training_days, 1)),
       training_schedule_completed = true,
       training_schedule_last_updated = now()
  FROM public.app_members m
 WHERE m.user_id = c.user_id
   AND c.service_tier = 'self_serve'
   AND coalesce(array_length(c.committed_training_days, 1), 0) = 0
   AND coalesce(array_length(m.committed_training_days, 1), 0) > 0;

UPDATE public.app_members m
   SET committed_training_days = c.committed_training_days,
       committed_training_frequency = coalesce(c.committed_training_frequency, array_length(c.committed_training_days, 1))
  FROM public.clients c
 WHERE c.user_id = m.user_id
   AND coalesce(array_length(c.committed_training_days, 1), 0) > 0
   AND (m.committed_training_days IS DISTINCT FROM c.committed_training_days
        OR m.committed_training_frequency IS DISTINCT FROM coalesce(c.committed_training_frequency, array_length(c.committed_training_days, 1)));

-- 3) JF Membership Agreement v3, a draft for the owner to read and publish in
--    Admin → Legal (publishing asks to confirm the wording was reviewed). Once
--    it is published, every member is asked to sign it in the app
--    (typed name + the health, risk and terms ticks, legal_acceptances).
INSERT INTO public.legal_document_versions
  (document_id, version_number, status, title, summary, body, signature_method,
   requires_reacceptance, reacceptance_audience, effective_date, needs_legal_review, legal_review_note)
SELECT d.id, 3, 'draft', 'JF Membership Agreement',
  'Self-serve membership as it works in the app today, plus health, assumption of risk and release terms for training on your own. Members sign it in the app once published.',
  $agreement$JF Membership Agreement
JF Effect, operated by Jared James McIntyre
Effective date: October 18, 2026    •    Last updated: October 18, 2026    •    Website: https://jfeffect.com
Version 3 replaces Version 2 (June 13, 2026). It describes JF Membership as it works in the JF Effect app today and adds the health, safety and release terms that apply when you train on your own.

This JF Membership Agreement (the "Agreement") is between you (the "Member") and Jared McIntyre (also known as Jared James McIntyre), an individual carrying on business as JF Effect in Winnipeg, Manitoba, Canada ("JF Effect", "we", "us"). Our Terms of Service, Privacy Policy, Recurring Billing Disclosure and Cancellation & Refund Policy form part of this Agreement. Where this Agreement and the Terms of Service cover the same issue, the one more specific to that issue governs.

1. What JF Membership Is
JF Membership is a self-serve digital membership in the JF Effect app. It includes:
- The Plan Library: training plans written by JF Effect that you start and run yourself. A plan you start is copied into your account and placed on the training days you choose.
- The workout logger, your history, personal records, analytics and app tools.
- Suggested nutrition targets, recipes and nutrition tools.
- Crew, the JF Effect community: posts, stories, follows, chats, Rankings and the Performance League.
- Support messages with JF Effect for help with your account and the app.
JF Membership is not personal coaching. No coach writes, reviews or adjusts your program, checks in with you or watches you train, and support messages are not coaching advice. Personal coaching is a separate service with its own Coaching Agreement. If you move to coaching, the Coaching Agreement covers your coaching from then on.

2. Who Can Join and Your Account
You must be at least the age of majority where you live (18 in Manitoba) and able to form a binding contract, or use the membership with a parent or guardian as set out in the Terms of Service.
Your account is for you alone. Do not share your login, keep it secure, and tell us straight away if you think someone else has used it. You are responsible for what happens on your account.

3. Trial, Price and Renewal
- New memberships start with a 3-day trial. $0 is charged at the start.
- After the trial, the membership is $29 USD per month plus applicable taxes and renews automatically each month until you cancel. Prices are in US dollars, and your bank may add conversion or foreign-transaction fees.
- You authorize Stripe to charge your payment method each month. Full details are in the Recurring Billing Disclosure.
- Where the app offers it, you can pause your membership or switch to the Hold Plan ($9 USD per month plus applicable taxes) instead of cancelling. While paused or on the Hold Plan, your account, history and progress are kept but membership features are locked.
- If a payment fails, Stripe may retry it and your access may be restricted until it is paid.
- If we change the price, we will give notice where required and the change applies going forward. You can cancel before it takes effect.

4. Cancelling
- Cancel any time from Membership in the app or through the Stripe Customer Portal.
- Cancellation takes effect at the end of your current trial or billing period. You keep access until then and future renewals stop. Until then, Keep Membership reverses the cancellation without creating a second subscription.
- Payments are generally non-refundable once a billing period starts. The Cancellation & Refund Policy explains the exceptions.
- Cancelling does not delete your account. You can delete your account at any time from Account Settings in the app.

5. Your Training Is Self-Directed
- Plans in the Plan Library are general programs written for many people, not for you. You choose the plan, your training days, your weights and how hard you push.
- Calculators, estimated maxes, suggested weights, warm-ups, exercise swaps, readiness scores, nutrition targets, points and other automated features are estimates to guide you. They are not medical advice and not a promise that a load, exercise or target is safe or right for you on a given day.
- You are responsible for learning the movements, using safe technique, choosing appropriate loads, using spotters or safety equipment when you need them, and training in a safe place with equipment in good condition. Follow the rules of any gym where you train.
- Keep what you log accurate. Records, rankings and suggestions are only as good as what is logged.

6. Health and Medical
- JF Effect provides general fitness and nutrition education only. We are not doctors, physiotherapists, dietitians or other licensed healthcare providers, and the membership is not medical care, rehabilitation, nutrition therapy or mental-health support.
- Before you start, and whenever your health changes, check with a doctor or another qualified professional if any of these apply to you: a heart condition or high blood pressure; chest pain, fainting or dizziness; a bone, joint or soft-tissue injury or condition that exercise could make worse; medication for your heart, blood pressure or blood sugar; diabetes or another chronic condition; pregnancy or recent childbirth; an eating disorder now or in the past; or any other reason you think training may not be safe for you.
- Stop training and get medical help if you feel pain, chest discomfort, dizziness, severe shortness of breath or anything unusual. In an emergency, call your local emergency number (911 in Canada and the United States). The app and support messages are not monitored for emergencies.
- Nutrition targets are general estimates from the information you enter. You are responsible for your food choices, allergies, intolerances and any supplements you take.

7. Assumption of Risk
Training has inherent risks, including serious injury, disability or death. Risks include strains, sprains, tears, joint injuries, dizziness, fainting, falls, equipment failure or misuse, worsening of earlier injuries and serious medical events. No one from JF Effect is with you when you train, so you are responsible for your own safety. You accept all risks of training with the membership, and you agree to train within your limits and to stop if something does not feel right.

8. Crew and Community Rules
- What you post in Crew (photos, videos, captions, comments, stories, reposts and reactions) is seen by the audience you choose. A private account's posts reach only the followers it approves, and Close Friends posts reach only your Close Friends list.
- Unless you switch off "Share my workouts" in your Crew settings, your finished workouts post to your Story and profile automatically. The Performance League shows the members who qualify each month with their first name and last initial, photo, points, workouts and records.
- Other members can find you in Crew by the name Crew shows or your username. Switch off "Suggest my account" to stop being suggested to people you are not connected to.
- Be respectful and supportive. Do not post anything abusive, sexual, hateful, misleading or unsafe, or anyone else's personal information, and do not copy or share other members' posts or messages outside the app.
- Chats with other members are private to the people in them. You can block or report anyone. Reports go to JF Effect, which may read the reported messages to deal with them.
- We may remove content and limit or end your Crew access for breaking these rules. Posts, comments and messages from other members are their own and are not advice from JF Effect.

9. Your Content
You keep ownership of what you post and log. You give JF Effect a limited, non-exclusive licence to host, store, display and process it to run the app and Crew. We will not use your photos, videos or name in advertising or on social media outside the app without your separate permission. You confirm you have the right to share what you post, including permission from anyone else who appears in it.

10. Devices, AI and App Changes
- If you connect Apple Health, Health Connect, a calendar or another app, the JF Effect app imports or shares only what you allow, and you can disconnect at any time. Device data can be inaccurate.
- Some features use artificial intelligence to write summaries or suggestions. AI output can be wrong, so use your judgment.
- Features may be added, changed or removed over time. We are not responsible for outages, internet or device problems, or failures of third-party services such as Stripe, Apple or Google. If you use the iPhone or Android app, Apple and Google are not parties to this Agreement and are not responsible for the membership.

11. Privacy
The Privacy Policy explains how we collect, use and protect your information, including your logs, body measurements, connected-device data, photos, videos and messages.

12. Release of Liability, Indemnity and Limits
- "Released Parties" means JF Effect, Jared McIntyre personally, and every coach, trainer, employee, contractor, agent and representative of JF Effect.
- To the fullest extent permitted by law, you waive, release and discharge the Released Parties from all claims, demands, damages, losses and liabilities arising from your use of the membership or your training. This includes claims related to negligence, where permitted by law, such as claims about plans, exercise selection, suggested weights or targets, app features and estimates, the lack of supervision and the actions of other members. This release also binds your heirs, executors, successors and assigns.
- You agree to indemnify and hold harmless the Released Parties from claims, losses and costs arising from your misconduct, your breach of this Agreement or your failure to train safely.
- To the fullest extent permitted by law, the Released Parties are not liable for indirect, incidental, special, punitive or consequential damages, and their total liability for any claim is limited to the membership fees you actually paid in the 12 months before the event that gave rise to it.
- Results are not guaranteed and depend on your circumstances and execution.
- Nothing in this Agreement limits liability for gross negligence or intentional misconduct, or any liability or right that cannot be limited or waived by law.

13. Disputes and Governing Law
Please email us first so we can try to sort out any issue. This Agreement is governed by the laws of the Province of Manitoba and the federal laws of Canada that apply there, subject to the mandatory consumer-protection rights where you live. To the fullest extent permitted by law, claims must be brought individually and not as part of a class action, and within 12 months of the event that gave rise to them.

14. Changes to This Agreement
We may update this Agreement. When we do, the app shows you the new version and asks you to accept it, and the changes apply going forward. If you do not want to accept a new version, you can cancel as set out in section 4.

15. Acceptance and Contact
You accept this Agreement electronically: at checkout by ticking the acceptance box, and in the app by ticking the confirmation boxes and typing your name. We keep a record of the version you accepted, the date, and the network and device details of the acceptance. Your electronic acceptance has the same effect as a handwritten signature.
Contact: JF Effect, operated by Jared James McIntyre, jaredjamesfit@gmail.com.$agreement$,
  'typed_name', true, 'all_clients', DATE '2026-10-18', true,
  'Drafted with Claude from the live app, the published Terms of Service, Recurring Billing Disclosure, Cancellation & Refund Policy and the Coaching Agreement 2.2. Check the price, Hold Plan, liability cap and release wording, then publish.'
  FROM public.legal_documents d
 WHERE d.slug = 'membership-agreement'
   AND NOT EXISTS (SELECT 1 FROM public.legal_document_versions v WHERE v.document_id = d.id AND v.version_number = 3);
