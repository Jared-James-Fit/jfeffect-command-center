INSERT INTO public.coaching_app_notification_recipients
  (name, role, phone, email,
   receive_application_sms, receive_booking_sms,
   receive_application_email, receive_booking_email,
   priority_only, paused)
SELECT 'Coach Jared', 'owner', '+12042294913', 'jaredjamesfit@gmail.com',
       true, true, true, true, false, false
WHERE NOT EXISTS (
  SELECT 1 FROM public.coaching_app_notification_recipients
  WHERE lower(coalesce(email, '')) = 'jaredjamesfit@gmail.com'
     OR regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g') = '12042294913'
);

UPDATE public.coaching_app_notification_recipients
SET phone = '+12042294913',
    email = 'jaredjamesfit@gmail.com',
    receive_application_sms = true,
    receive_booking_sms = true,
    receive_application_email = true,
    receive_booking_email = true,
    priority_only = false,
    paused = false,
    updated_at = now()
WHERE lower(coalesce(email, '')) = 'jaredjamesfit@gmail.com'
   OR regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g') = '12042294913';