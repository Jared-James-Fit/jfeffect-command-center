-- Live challenges: event-day fixes, found by running the build against a
-- scripted event (registration, ties, final results) on Postgres 16.
--
-- 1. Self sign-up from the venue's Wi-Fi: the whole room shares one public
--    address, and the 9th person to scan the QR within 15 minutes (21st in an
--    hour) was told "Too many sign-ups". Limits raised to 60 per challenge per
--    15 minutes and 150 an hour per address; every sign-up still needs its own
--    email, and a repeat email is refused.
-- 2. Prizes on a tie: with two people tied for 1st, the 2nd-place prize had no
--    winner and wasn't reported (nobody was ranked exactly 2nd). A prize now
--    goes to whoever's place covers it; when that's more than one person it's
--    reported with the other ties for the owner to award, never left empty.
-- 3. Final results: an admin could still change a bodyweight, division or
--    status after confirming, which re-ranked the public "final" board while
--    the prizes stayed where they were. Those changes now need the results
--    reopened (which confirms the winners again); a name or photo fix is fine.
-- Same signatures and grants as 20270206090000_live_challenges.sql.

CREATE OR REPLACE FUNCTION public.challenge_register(p_challenge uuid, p jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  c public.challenges%ROWTYPE;
  v_staff boolean := public.challenge_can(p_challenge, 'register');
  v_uid uuid := auth.uid();
  v_public text := btrim(coalesce(p ->> 'public_name', ''));
  v_full text := btrim(coalesce(p ->> 'full_name', ''));
  v_email text := lower(btrim(coalesce(p ->> 'email', '')));
  v_phone text := nullif(btrim(coalesce(p ->> 'phone', '')), '');
  v_ig text := nullif(ltrim(btrim(coalesce(p ->> 'instagram', '')), '@'), '');
  v_div uuid;
  v_show boolean := coalesce((p ->> 'show_photo')::boolean, false);
  v_mkt boolean := coalesce((p ->> 'marketing_opt_in')::boolean, false);
  v_ack jsonb := coalesce(p -> 'acknowledged', '[]'::jsonb);
  v_bw numeric := CASE WHEN v_staff THEN nullif(p ->> 'bodyweight_kg', '')::numeric END;
  v_ref uuid;
  v_ref_source text := nullif(p ->> 'ref_source', '');
  v_person uuid; v_entry uuid; v_bib int; v_code text; v_token text; v_existing uuid;
  v_count int; v_ip text;
BEGIN
  SELECT * INTO c FROM public.challenges WHERE id = p_challenge FOR UPDATE;
  IF NOT FOUND OR c.is_template THEN RAISE EXCEPTION 'Challenge not found.' USING ERRCODE = 'P0002'; END IF;

  IF v_staff THEN
    IF c.status NOT IN ('draft','upcoming','live','paused','verifying') THEN
      RAISE EXCEPTION 'Registration is closed for this challenge.' USING ERRCODE = 'P0001';
    END IF;
  ELSE
    IF NOT c.self_registration OR c.status NOT IN ('upcoming','live','paused') THEN
      RAISE EXCEPTION 'Registration is closed for this challenge.' USING ERRCODE = 'P0001';
    END IF;
    v_ip := public._challenge_client_ip();
    -- a gym's Wi-Fi puts the whole room behind one address, so the limits are
    -- sized for a QR rush at the door (each sign-up still needs its own email)
    IF NOT public._challenge_rate_ok('reg:' || p_challenge || ':' || v_ip, 60, interval '15 minutes')
       OR NOT public._challenge_rate_ok('reg:' || v_ip, 150, interval '1 hour') THEN
      RAISE EXCEPTION 'Too many sign-ups from this connection. Ask event staff to register you.' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- validation
  IF length(v_public) NOT BETWEEN 1 AND 40 THEN RAISE EXCEPTION 'Add the name to show on the leaderboard (40 characters max).' USING ERRCODE = 'P0001'; END IF;
  IF length(v_full) NOT BETWEEN 2 AND 80 THEN RAISE EXCEPTION 'Add your full name.' USING ERRCODE = 'P0001'; END IF;
  IF v_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' OR length(v_email) > 200 THEN RAISE EXCEPTION 'Add a valid email.' USING ERRCODE = 'P0001'; END IF;
  IF v_phone IS NOT NULL AND (length(regexp_replace(v_phone, '\D', '', 'g')) NOT BETWEEN 7 AND 15) THEN RAISE EXCEPTION 'That phone number doesn''t look right.' USING ERRCODE = 'P0001'; END IF;
  IF coalesce(c.collect ->> 'phone', 'optional') = 'required' AND v_phone IS NULL THEN RAISE EXCEPTION 'Add a phone number.' USING ERRCODE = 'P0001'; END IF;
  IF coalesce(c.collect ->> 'instagram', 'optional') = 'required' AND v_ig IS NULL THEN RAISE EXCEPTION 'Add your Instagram.' USING ERRCODE = 'P0001'; END IF;
  IF coalesce(c.collect ->> 'phone', 'optional') = 'off' THEN v_phone := NULL; END IF;
  IF coalesce(c.collect ->> 'instagram', 'optional') = 'off' THEN v_ig := NULL; END IF;
  IF v_ig IS NOT NULL AND v_ig !~ '^[A-Za-z0-9._]{1,30}$' THEN RAISE EXCEPTION 'That Instagram handle doesn''t look right.' USING ERRCODE = 'P0001'; END IF;
  IF jsonb_typeof(v_ack) <> 'array' OR jsonb_array_length(v_ack) < jsonb_array_length(c.acknowledgments)
     OR NOT (c.acknowledgments <@ v_ack) THEN
    RAISE EXCEPTION 'Every box has to be ticked to compete.' USING ERRCODE = 'P0001';
  END IF;
  IF v_bw IS NOT NULL AND (v_bw < 25 OR v_bw > 350) THEN RAISE EXCEPTION 'That bodyweight doesn''t look right.' USING ERRCODE = 'P0001'; END IF;

  IF EXISTS (SELECT 1 FROM public.challenge_divisions d WHERE d.challenge_id = c.id) THEN
    SELECT d.id INTO v_div FROM public.challenge_divisions d WHERE d.challenge_id = c.id AND d.id = nullif(p ->> 'division_id', '')::uuid;
    IF v_div IS NULL THEN RAISE EXCEPTION 'Pick a division.' USING ERRCODE = 'P0001'; END IF;
  END IF;

  IF c.max_participants IS NOT NULL THEN
    SELECT count(*) INTO v_count FROM public.challenge_entries WHERE challenge_id = c.id AND status <> 'withdrawn';
    IF v_count >= c.max_participants THEN RAISE EXCEPTION 'This challenge is full.' USING ERRCODE = 'P0001'; END IF;
  END IF;

  -- already in this challenge with that email?
  SELECT e.id INTO v_existing FROM public.challenge_entries e
    JOIN public.challenge_people_private pp ON pp.person_id = e.person_id
    WHERE e.challenge_id = c.id AND lower(pp.email) = v_email AND e.status <> 'withdrawn' LIMIT 1;
  IF v_existing IS NOT NULL THEN
    IF v_staff THEN
      RETURN (SELECT jsonb_build_object('entry_id', e.id, 'code', e.share_code, 'bib', e.bib, 'existing', true) FROM public.challenge_entries e WHERE e.id = v_existing);
    END IF;
    RAISE EXCEPTION 'That email is already registered for this challenge. Find event staff if you need a hand.' USING ERRCODE = 'P0001';
  END IF;

  -- who is this? staff entries (trusted) and signed-in people reuse their profile;
  -- a public sign-up never attaches to someone else's profile by typing their email.
  IF v_uid IS NOT NULL AND NOT v_staff THEN
    SELECT id INTO v_person FROM public.challenge_people WHERE user_id = v_uid;
  END IF;
  IF v_person IS NULL AND v_staff THEN
    SELECT pp.person_id INTO v_person FROM public.challenge_people_private pp
      JOIN public.challenge_people pe ON pe.id = pp.person_id
      WHERE lower(pp.email) = v_email
      ORDER BY (pe.user_id IS NOT NULL) DESC, pe.created_at LIMIT 1;
  END IF;
  -- a withdrawn entry in this challenge comes back instead of a second row
  IF v_person IS NOT NULL THEN
    SELECT e.id INTO v_existing FROM public.challenge_entries e WHERE e.challenge_id = c.id AND e.person_id = v_person;
    IF v_existing IS NOT NULL THEN
      IF (SELECT status FROM public.challenge_entries WHERE id = v_existing) <> 'withdrawn' THEN
        IF v_staff THEN
          RETURN (SELECT jsonb_build_object('entry_id', e.id, 'code', e.share_code, 'bib', e.bib, 'existing', true) FROM public.challenge_entries e WHERE e.id = v_existing);
        END IF;
        RAISE EXCEPTION 'You''re already registered for this challenge.' USING ERRCODE = 'P0001';
      END IF;
      UPDATE public.challenge_entries SET status = 'registered', status_reason = NULL, public_name = v_public,
        division_id = v_div, show_photo = v_show, acknowledged = v_ack, acknowledged_at = now(),
        bodyweight_kg = coalesce(v_bw, bodyweight_kg)
      WHERE id = v_existing;
      PERFORM public._challenge_audit(c.id, 'reregister', 'entry', v_existing, jsonb_build_object('source', CASE WHEN v_staff THEN 'staff' ELSE 'self' END));
      IF v_show THEN
        v_token := encode(extensions.gen_random_bytes(24), 'hex');
        INSERT INTO public.challenge_photo_tickets(token_hash, person_id, entry_id) VALUES (encode(extensions.digest(v_token, 'sha256'), 'hex'), v_person, v_existing);
      END IF;
      RETURN (SELECT jsonb_build_object('entry_id', e.id, 'code', e.share_code, 'bib', e.bib, 'existing', true, 'photo_ticket', v_token) FROM public.challenge_entries e WHERE e.id = v_existing);
    END IF;
  END IF;

  IF v_person IS NULL THEN
    INSERT INTO public.challenge_people(handle, display_name, user_id)
    VALUES (public._challenge_handle(v_public), v_public,
            CASE WHEN v_uid IS NOT NULL AND NOT v_staff
                      AND lower((SELECT u.email FROM auth.users u WHERE u.id = v_uid AND u.email_confirmed_at IS NOT NULL)) = v_email
                 THEN v_uid END)
    RETURNING id INTO v_person;
    INSERT INTO public.challenge_people_private(person_id, full_name, email, phone, instagram, marketing_opt_in, marketing_opt_in_at)
    VALUES (v_person, v_full, v_email, v_phone, v_ig, v_mkt, CASE WHEN v_mkt THEN now() END);
  ELSE
    -- keep their contact details current; marketing consent is only ever added here, never removed silently
    UPDATE public.challenge_people_private SET
      full_name = v_full, phone = coalesce(v_phone, phone), instagram = coalesce(v_ig, instagram),
      marketing_opt_in = marketing_opt_in OR v_mkt,
      marketing_opt_in_at = CASE WHEN v_mkt AND NOT marketing_opt_in THEN now() ELSE marketing_opt_in_at END
    WHERE person_id = v_person;
  END IF;

  IF p ->> 'ref' IS NOT NULL THEN
    SELECT e.id INTO v_ref FROM public.challenge_entries e WHERE e.share_code = lower(btrim(p ->> 'ref'));
  END IF;
  IF v_ref_source IS NOT NULL AND v_ref_source NOT IN ('qr','link','friend','display') THEN v_ref_source := NULL; END IF;
  IF v_ref IS NOT NULL THEN v_ref_source := 'friend'; END IF;

  PERFORM pg_advisory_xact_lock(hashtext('challenge_bib:' || c.id::text));
  SELECT coalesce(max(bib), 0) + 1 INTO v_bib FROM public.challenge_entries WHERE challenge_id = c.id;
  LOOP
    v_code := public._challenge_code(8);
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.challenge_entries WHERE share_code = v_code);
  END LOOP;

  INSERT INTO public.challenge_entries(challenge_id, person_id, division_id, bib, share_code, public_name, show_photo,
    bodyweight_kg, source, ref_source, referred_by, acknowledged, registered_by)
  VALUES (c.id, v_person, v_div, v_bib, v_code, v_public, v_show, v_bw,
    CASE WHEN v_staff THEN 'staff' ELSE 'self' END, v_ref_source, v_ref, v_ack, v_uid)
  RETURNING id INTO v_entry;

  IF v_show THEN
    v_token := encode(extensions.gen_random_bytes(24), 'hex');
    INSERT INTO public.challenge_photo_tickets(token_hash, person_id, entry_id)
    VALUES (encode(extensions.digest(v_token, 'sha256'), 'hex'), v_person, v_entry);
  END IF;

  PERFORM public._challenge_audit(c.id, 'register', 'entry', v_entry,
    jsonb_build_object('source', CASE WHEN v_staff THEN 'staff' ELSE 'self' END, 'bib', v_bib, 'ref_source', v_ref_source));

  RETURN jsonb_build_object('entry_id', v_entry, 'code', v_code, 'bib', v_bib, 'existing', false,
    'photo_ticket', v_token, 'handle', (SELECT handle FROM public.challenge_people WHERE id = v_person));
END $$;

CREATE OR REPLACE FUNCTION public.challenge_finalize(p_challenge uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE c public.challenges%ROWTYPE; pz record; v_ids uuid[]; v_ties jsonb := '[]'::jsonb; v_sep boolean; v_assigned int := 0;
BEGIN
  SELECT * INTO c FROM public.challenges WHERE id = p_challenge FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Challenge not found.' USING ERRCODE = 'P0002'; END IF;
  IF NOT public.challenge_can(c.id, 'admin') THEN RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501'; END IF;
  IF c.status <> 'verifying' THEN RAISE EXCEPTION 'End the event before confirming results.' USING ERRCODE = 'P0001'; END IF;
  v_sep := public._challenge_divisions_separate(c.id);

  FOR pz IN SELECT * FROM public.challenge_prizes WHERE challenge_id = c.id ORDER BY place LOOP
    IF pz.winner_source = 'admin' AND pz.winner_entry_id IS NOT NULL THEN CONTINUE; END IF;
    -- everyone whose place covers this prize: two tied for 1st cover 1st and 2nd
    SELECT array_agg(w.entry_id) INTO v_ids FROM (
      SELECT x.entry_id, x.rk, count(*) OVER (PARTITION BY x.grp, x.rk) AS n
      FROM (
        SELECT r.entry_id,
          CASE WHEN pz.division_id IS NULL AND NOT v_sep THEN r.rank_all ELSE r.rank_div END AS rk,
          CASE WHEN pz.division_id IS NULL AND NOT v_sep THEN NULL ELSE r.division_id END AS grp
        FROM public._challenge_rank(c.id) r
        WHERE pz.division_id IS NULL OR r.division_id = pz.division_id
      ) x
    ) w
    WHERE w.rk <= pz.place AND w.rk + w.n - 1 >= pz.place;
    IF coalesce(array_length(v_ids, 1), 0) = 1 THEN
      UPDATE public.challenge_prizes SET winner_entry_id = v_ids[1], winner_source = 'auto' WHERE id = pz.id;
      v_assigned := v_assigned + 1;
    ELSE
      UPDATE public.challenge_prizes SET winner_entry_id = NULL, winner_source = NULL WHERE id = pz.id;
      IF coalesce(array_length(v_ids, 1), 0) > 1 THEN
        v_ties := v_ties || jsonb_build_object('prize_id', pz.id, 'place', pz.place, 'title', pz.title,
          'names', (SELECT jsonb_agg(e.public_name ORDER BY e.public_name) FROM public.challenge_entries e WHERE e.id = ANY(v_ids)));
      END IF;
    END IF;
  END LOOP;

  PERFORM set_config('jf.challenge_rpc', 'on', true);
  UPDATE public.challenges SET status = 'completed', results_final_at = now(), final_by = auth.uid(),
    ended_at = coalesce(ended_at, now()) WHERE id = c.id;
  PERFORM set_config('jf.challenge_rpc', 'off', true);
  PERFORM public._challenge_audit(c.id, 'finalize', 'challenge', c.id, jsonb_build_object('assigned', v_assigned, 'ties', v_ties));
  RETURN jsonb_build_object('assigned', v_assigned, 'ties', v_ties);
END $$;

CREATE OR REPLACE FUNCTION public.challenge_update_entry(p_entry uuid, p jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE e public.challenge_entries%ROWTYPE; c public.challenges%ROWTYPE; v_status text; v_div uuid; v_bw numeric;
BEGIN
  SELECT * INTO e FROM public.challenge_entries WHERE id = p_entry FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Entry not found.' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO c FROM public.challenges WHERE id = e.challenge_id;
  IF NOT public.challenge_can(c.id, 'register') THEN RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501'; END IF;
  IF c.status IN ('completed','archived') AND NOT public.challenge_can(c.id, 'admin') THEN
    RAISE EXCEPTION 'Results are final. Reopen them to change an entry.' USING ERRCODE = 'P0001';
  END IF;
  -- the published final standings never move on their own: a change to anything
  -- that ranks (status, division, the bodyweight that breaks ties) needs the
  -- results reopened, which confirms winners again. A name or photo fix is fine.
  IF c.status IN ('completed','archived') AND (
       (p ? 'status' AND p ->> 'status' IS DISTINCT FROM e.status)
    OR (p ? 'division_id' AND nullif(p ->> 'division_id', '') IS DISTINCT FROM e.division_id::text)
    OR (p ? 'bodyweight_kg' AND nullif(p ->> 'bodyweight_kg', '')::numeric IS DISTINCT FROM e.bodyweight_kg)) THEN
    RAISE EXCEPTION 'Results are final. Reopen them to change anything that affects the standings.' USING ERRCODE = 'P0001';
  END IF;
  v_status := coalesce(p ->> 'status', e.status);
  IF v_status NOT IN ('registered','checked_in','withdrawn','disqualified') THEN RAISE EXCEPTION 'Unknown status.' USING ERRCODE = 'P0001'; END IF;
  IF v_status = 'disqualified' AND e.status <> 'disqualified' THEN
    IF NOT public.challenge_can(c.id, 'judge') THEN RAISE EXCEPTION 'Only a judge can disqualify.' USING ERRCODE = '42501'; END IF;
    IF length(btrim(coalesce(p ->> 'status_reason', ''))) < 3 THEN RAISE EXCEPTION 'Say why they''re disqualified.' USING ERRCODE = 'P0001'; END IF;
  END IF;
  IF e.status = 'disqualified' AND v_status <> 'disqualified' AND NOT public.challenge_can(c.id, 'manage') THEN
    RAISE EXCEPTION 'Only the event manager can reinstate a disqualified entry.' USING ERRCODE = '42501';
  END IF;
  IF p ? 'division_id' THEN
    SELECT d.id INTO v_div FROM public.challenge_divisions d WHERE d.challenge_id = c.id AND d.id = nullif(p ->> 'division_id', '')::uuid;
    IF v_div IS NULL AND EXISTS (SELECT 1 FROM public.challenge_divisions d WHERE d.challenge_id = c.id) THEN
      RAISE EXCEPTION 'Pick a division.' USING ERRCODE = 'P0001';
    END IF;
  ELSE
    v_div := e.division_id;
  END IF;
  v_bw := CASE WHEN p ? 'bodyweight_kg' THEN nullif(p ->> 'bodyweight_kg', '')::numeric ELSE e.bodyweight_kg END;
  IF v_bw IS NOT NULL AND (v_bw < 25 OR v_bw > 350) THEN RAISE EXCEPTION 'That bodyweight doesn''t look right.' USING ERRCODE = 'P0001'; END IF;
  IF p ? 'public_name' AND length(btrim(coalesce(p ->> 'public_name', ''))) NOT BETWEEN 1 AND 40 THEN
    RAISE EXCEPTION 'Add the name to show on the leaderboard.' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.challenge_entries SET
    public_name = CASE WHEN p ? 'public_name' THEN btrim(p ->> 'public_name') ELSE public_name END,
    division_id = v_div,
    status = v_status,
    status_reason = CASE WHEN v_status IN ('withdrawn','disqualified') THEN nullif(btrim(coalesce(p ->> 'status_reason', status_reason, '')), '') ELSE NULL END,
    bodyweight_kg = v_bw,
    show_photo = CASE WHEN p ? 'show_photo' THEN (p ->> 'show_photo')::boolean ELSE show_photo END
  WHERE id = e.id;

  PERFORM public._challenge_audit(c.id, 'update', 'entry', e.id, jsonb_build_object(
    'before', jsonb_build_object('public_name', e.public_name, 'division_id', e.division_id, 'status', e.status, 'bodyweight_kg', e.bodyweight_kg, 'show_photo', e.show_photo),
    'change', p - 'bodyweight_kg' || CASE WHEN p ? 'bodyweight_kg' THEN jsonb_build_object('bodyweight_kg', 'changed') ELSE '{}'::jsonb END));
  RETURN jsonb_build_object('ok', true);
END $$;
