CREATE OR REPLACE FUNCTION public.admin_clients_directory(p_search text DEFAULT NULL::text, p_status text DEFAULT NULL::text, p_coaching_type text DEFAULT NULL::text, p_coach_id uuid DEFAULT NULL::uuid, p_sort text DEFAULT 'attention'::text, p_limit integer DEFAULT 15, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_is_admin boolean := public.has_role(auth.uid(), 'admin'::app_role);
  v_today date := (now() AT TIME ZONE 'utc')::date;
  v_rows jsonb;
  v_total int;
  v_counts jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  WITH base AS (
    SELECT c.*
    FROM public.clients c
    WHERE c.archived = false
      AND (v_is_admin OR public.is_assigned_coach(c.id))
  ),
  cur_block AS (
    SELECT DISTINCT ON (b.client_id)
      b.client_id, b.id, b.name, b.start_date, b.end_date, b.status
    FROM public.pl_blocks b
    WHERE b.archived = false
      AND b.client_id IN (SELECT id FROM base)
      AND (b.end_date IS NULL OR b.end_date >= v_today - 7)
    ORDER BY b.client_id,
      (CASE WHEN b.start_date IS NULL THEN 1 ELSE 0 END),
      b.start_date DESC NULLS LAST
  ),
  cur_nut AS (
    SELECT DISTINCT ON (client_id) client_id, start_date, end_date, status
    FROM public.nutrition_targets
    WHERE client_id IN (SELECT id FROM base)
    ORDER BY client_id, COALESCE(start_date, '1900-01-01'::date) DESC
  ),
  cur_card AS (
    SELECT DISTINCT ON (client_id) client_id, start_date, end_date, status
    FROM public.cardio_targets
    WHERE client_id IN (SELECT id FROM base)
    ORDER BY client_id, COALESCE(start_date, '1900-01-01'::date) DESC
  ),
  pending_reviews AS (
    SELECT client_id, count(*) AS n
    FROM public.submission_reviews
    WHERE client_id IN (SELECT id FROM base)
      AND COALESCE(review_status,'') IN ('pending','needs_review','submitted')
    GROUP BY client_id
  ),
  enriched AS (
    SELECT
      b.id, b.full_name, b.email, b.profile_picture_url, b.coaching_type,
      b.assigned_coach_id, b.status AS client_status, b.account_status,
      b.payment_status, b.needs_admin_help, b.created_at, b.updated_at,
      b.next_program_update,
      co.full_name AS coach_name,
      cb.id AS block_id, cb.name AS block_name,
      cb.start_date AS block_start, cb.end_date AS block_end, cb.status AS block_status,
      cn.end_date AS nut_end,
      cc.end_date AS card_end,
      COALESCE(pr.n, 0) AS pending_reviews,
      -- NEEDS SETUP: only genuine onboarding gaps.
      -- Account not yet activated by the user (invite pending / reset pending), OR
      -- required agreement unsigned. Preferred-training-days is NOT a setup gap.
      (
        b.account_status IN ('Invite Not Sent','Invite Sent','Invite Expired','Password Reset Sent')
        OR (b.agreement_status IS NOT NULL AND b.agreement_status IN ('Not Sent','Sent','Pending'))
      ) AS f_needs_setup,
      (COALESCE(pr.n,0) > 0) AS f_needs_review,
      (cb.end_date IS NOT NULL AND cb.end_date BETWEEN v_today AND v_today + 14) AS f_program_ending,
      (cb.id IS NULL OR (cb.end_date IS NOT NULL AND cb.end_date < v_today)) AS f_missing_program,
      (LOWER(COALESCE(b.payment_status,'')) IN ('overdue','failed','past_due','past due'))
        OR b.status = 'Payment Overdue' AS f_payment_issue,
      -- NEW CLIENT: joined within the last 30 days. Reflects recency only.
      (b.created_at > now() - interval '30 days') AS f_new_client,
      (cn.client_id IS NULL OR (cn.end_date IS NOT NULL AND cn.end_date < v_today)) AS f_missing_nutrition,
      (cc.client_id IS NULL OR (cc.end_date IS NOT NULL AND cc.end_date < v_today)) AS f_missing_cardio,
      (cb.id IS NOT NULL AND (cb.end_date IS NULL OR cb.end_date >= v_today)) AS f_has_active_program,
      (b.account_status IN ('Account Created','Active')) AS f_account_activated
    FROM base b
    LEFT JOIN public.coaches co ON co.id = b.assigned_coach_id
    LEFT JOIN cur_block cb ON cb.client_id = b.id
    LEFT JOIN cur_nut cn ON cn.client_id = b.id
    LEFT JOIN cur_card cc ON cc.client_id = b.id
    LEFT JOIN pending_reviews pr ON pr.client_id = b.id
  ),
  scored AS (
    SELECT e.*,
      CASE
        WHEN f_payment_issue THEN 1
        WHEN f_needs_setup AND NOT f_account_activated THEN 2
        WHEN f_needs_review THEN 3
        WHEN f_missing_program THEN 4
        WHEN f_program_ending THEN 5
        WHEN f_missing_nutrition OR f_missing_cardio THEN 6
        WHEN f_needs_setup THEN 7
        ELSE 9
      END AS priority,
      CASE
        WHEN f_payment_issue THEN jsonb_build_object('kind','payment','label','Resolve Payment')
        WHEN f_needs_setup AND NOT f_account_activated THEN jsonb_build_object('kind','setup','label','Complete Setup')
        WHEN f_needs_review THEN jsonb_build_object('kind','review','label','Review Check-In')
        WHEN f_missing_program AND f_has_active_program = false THEN jsonb_build_object('kind','assign','label','Assign Program')
        WHEN f_missing_program THEN jsonb_build_object('kind','assign','label','Assign Next Program')
        WHEN f_program_ending THEN jsonb_build_object('kind','next_phase','label','Build Next Phase')
        WHEN f_missing_nutrition THEN jsonb_build_object('kind','nutrition','label','Update Nutrition')
        WHEN f_missing_cardio THEN jsonb_build_object('kind','cardio','label','Update Cardio')
        ELSE jsonb_build_object('kind','open','label','Open Client')
      END AS next_action
    FROM enriched e
  ),
  count_source AS (
    SELECT s.*
    FROM scored s
    WHERE (p_search IS NULL OR p_search = '' OR
           s.full_name ILIKE '%' || p_search || '%' OR
           s.email ILIKE '%' || p_search || '%')
      AND (p_coaching_type IS NULL OR p_coaching_type = '' OR p_coaching_type = 'all'
           OR s.coaching_type = p_coaching_type)
      AND (p_coach_id IS NULL OR s.assigned_coach_id = p_coach_id)
  ),
  filtered AS (
    SELECT cs.*
    FROM count_source cs
    WHERE p_status IS NULL OR p_status = '' OR p_status = 'all'
      OR (p_status = 'needs_setup' AND cs.f_needs_setup AND NOT cs.f_account_activated)
      OR (p_status = 'needs_review' AND cs.f_needs_review)
      OR (p_status = 'program_ending' AND cs.f_program_ending)
      OR (p_status = 'payment_issues' AND cs.f_payment_issue)
      OR (p_status = 'new_clients' AND cs.f_new_client)
  ),
  ordered AS (
    SELECT *,
      row_number() OVER (
        ORDER BY
          CASE WHEN p_sort = 'attention' THEN priority END ASC,
          CASE WHEN p_sort = 'recent' THEN created_at END DESC,
          CASE WHEN p_sort = 'name' THEN full_name END ASC,
          CASE WHEN p_sort = 'ending' THEN block_end END ASC NULLS LAST,
          CASE WHEN p_sort = 'activity' THEN updated_at END DESC,
          full_name ASC
      ) AS rn
    FROM filtered
  )
  SELECT
    COALESCE((SELECT jsonb_agg(to_jsonb(o.*) - 'rn' - 'f_account_activated' - 'f_has_active_program' ORDER BY o.rn) FROM ordered o WHERE o.rn > p_offset AND o.rn <= p_offset + p_limit), '[]'::jsonb),
    COALESCE((SELECT COUNT(*) FROM filtered), 0),
    COALESCE((
      SELECT jsonb_build_object(
        'all', COUNT(*),
        'needs_setup', COUNT(*) FILTER (WHERE f_needs_setup AND NOT f_account_activated),
        'needs_review', COUNT(*) FILTER (WHERE f_needs_review),
        'program_ending', COUNT(*) FILTER (WHERE f_program_ending),
        'payment_issues', COUNT(*) FILTER (WHERE f_payment_issue),
        'new_clients', COUNT(*) FILTER (WHERE f_new_client)
      )
      FROM count_source
    ), jsonb_build_object('all', 0, 'needs_setup', 0, 'needs_review', 0, 'program_ending', 0, 'payment_issues', 0, 'new_clients', 0))
  INTO v_rows, v_total, v_counts;

  RETURN jsonb_build_object(
    'rows', v_rows,
    'total', v_total,
    'counts', v_counts
  );
END;
$function$;