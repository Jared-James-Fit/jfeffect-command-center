-- When a page fails past its quiet retries, the error screen records what broke
-- (route, message, stack) as a support alert, so the cause can be read instead
-- of guessed. Any signed-in user can report their own failure; one alert per
-- user, route and message per hour (repeats bump a counter), nobody is notified.

CREATE OR REPLACE FUNCTION public.report_page_error(_route text, _message text, _stack text DEFAULT NULL, _device jsonb DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_route text := left(coalesce(_route, ''), 300);
  v_msg text := left(coalesce(nullif(trim(_message), ''), 'Unknown error'), 1000);
  v_client uuid;
  v_id uuid;
BEGIN
  IF v_uid IS NULL THEN RETURN; END IF;
  SELECT id INTO v_id FROM public.support_alerts
   WHERE error_type = 'page_error' AND page_route = v_route AND error_message = v_msg
     AND details ->> 'user_id' = v_uid::text AND created_at > now() - interval '1 hour'
   LIMIT 1;
  IF v_id IS NOT NULL THEN
    UPDATE public.support_alerts
       SET details = jsonb_set(details, '{count}', to_jsonb(coalesce((details ->> 'count')::int, 1) + 1)),
           updated_at = now()
     WHERE id = v_id;
    RETURN;
  END IF;
  SELECT id INTO v_client FROM public.clients WHERE user_id = v_uid LIMIT 1;
  INSERT INTO public.support_alerts (client_id, page_route, error_type, error_message, device_info, details)
  VALUES (v_client, v_route, 'page_error', v_msg, _device,
          jsonb_build_object('user_id', v_uid, 'stack', left(coalesce(_stack, ''), 4000), 'count', 1));
END;
$$;

REVOKE ALL ON FUNCTION public.report_page_error(text, text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.report_page_error(text, text, text, jsonb) TO authenticated;
