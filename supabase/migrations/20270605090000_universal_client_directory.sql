-- A paid or invited meet-handling relationship belongs in the same client
-- directory's handling view. Account tier still controls entitlements; never promote members
-- to full coaching merely to display them. The existing RPC still owns search,
-- lifecycle, filters, pagination and counts, and returns one row per client.
SET lock_timeout = '3s';
DO $$
DECLARE
  def text;
  anchor text;
  replacement text;
  f regprocedure := 'public.admin_clients_directory(text,text,text,uuid,text,integer,integer,text,text[],text)'::regprocedure;
BEGIN
  def := pg_get_functiondef(f);
  IF position('universal_handling_directory' in def) > 0 THEN RETURN; END IF;
  anchor := E'    where (v_is_admin or public.is_assigned_coach(c.id))\n      and c.service_tier = ''coaching''';
  replacement := E'    where (v_is_admin or public.is_assigned_coach(c.id) or (p_coaching_type = ''Competition Handling'' and c.id IN (SELECT public.coached_client_ids())))\n      and (c.service_tier = ''coaching'' or (p_coaching_type = ''Competition Handling'' and exists (select 1 from public.competition_handling h where h.client_id = c.id))) -- universal_handling_directory';
  IF (length(def) - length(replace(def, anchor, ''))) / length(anchor) <> 1 THEN
    RAISE EXCEPTION 'Universal client directory: scope anchor changed';
  END IF;
  def := replace(def, anchor, replacement);
  anchor := 'b.id, b.full_name, b.email, b.profile_picture_url, b.coaching_type,';
  replacement := 'b.id, b.full_name, b.email, b.profile_picture_url, case when b.service_tier <> ''coaching'' then ''Competition Handling'' else b.coaching_type end as coaching_type,';
  IF (length(def) - length(replace(def, anchor, ''))) / length(anchor) <> 1 THEN
    RAISE EXCEPTION 'Universal client directory: identity anchor changed';
  END IF;
  def := replace(def, anchor, replacement);
  -- Training expectations only apply to coaching accounts. Real payments,
  -- actual check-ins and account setup continue through the normal flags.
  FOR anchor, replacement IN SELECT * FROM (VALUES
    ('(cb.end_date is not null and cb.end_date between v_today and v_today + 14 and nb.id is null) as f_program_ending',
     '(b.service_tier = ''coaching'' and cb.end_date is not null and cb.end_date between v_today and v_today + 14 and nb.id is null) as f_program_ending'),
    ('((cb.id is null or (cb.end_date is not null and cb.end_date < v_today)) and nb.id is null) as f_missing_program',
     '(b.service_tier = ''coaching'' and (cb.id is null or (cb.end_date is not null and cb.end_date < v_today)) and nb.id is null) as f_missing_program'),
    ('(cn.client_id is null or (cn.end_date is not null and cn.end_date < v_today)) as f_missing_nutrition',
     '(b.service_tier = ''coaching'' and (cn.client_id is null or (cn.end_date is not null and cn.end_date < v_today))) as f_missing_nutrition'),
    ('(cc.client_id is null or (cc.end_date is not null and cc.end_date < v_today)) as f_missing_cardio',
     '(b.service_tier = ''coaching'' and (cc.client_id is null or (cc.end_date is not null and cc.end_date < v_today))) as f_missing_cardio'),
    ('(coalesce(ms.n, 0) >= 2) as f_missed_workouts',
     '(b.service_tier = ''coaching'' and coalesce(ms.n, 0) >= 2) as f_missed_workouts'),
    (E'(cb.id is not null and (cb.end_date is null or cb.end_date >= v_today)\n        and coalesce(b.last_active_at, b.last_signed_in_at) is not null',
     E'(b.service_tier = ''coaching'' and cb.id is not null and (cb.end_date is null or cb.end_date >= v_today)\n        and coalesce(b.last_active_at, b.last_signed_in_at) is not null'),
    ('or s.coaching_type = p_coaching_type)',
     'or s.coaching_type = p_coaching_type or (p_coaching_type = ''Competition Handling'' and exists (select 1 from public.competition_handling h where h.client_id = s.id)))')
  ) AS patches(a,b)
  LOOP
    IF (length(def) - length(replace(def, anchor, ''))) / length(anchor) <> 1 THEN
      RAISE EXCEPTION 'Universal client directory: changed flag/filter anchor %', anchor;
    END IF;
    def := replace(def, anchor, replacement);
  END LOOP;
  EXECUTE def;
END $$;
