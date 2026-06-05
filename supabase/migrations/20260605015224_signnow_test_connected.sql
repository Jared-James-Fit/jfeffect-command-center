-- Reflect verified successful SignNow /user probe (HTTP 200) into signnow_settings.
-- account_email intentionally left as-is; UI Test Connection will refresh it on next click.
update public.signnow_settings
set status = 'Connected',
    last_test_at = now(),
    last_test_result = 'Connected via SIGNNOW_API_TOKEN (/user returned 200).',
    access_token_status = 'Valid',
    last_error = null
where singleton = true;
