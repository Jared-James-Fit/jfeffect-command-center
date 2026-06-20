-- Ensure Jared receives both SMS and Email alerts for new coaching applications and bookings.
INSERT INTO public.coaching_app_notification_recipients
  (name, role, phone, email,
   receive_application_sms, receive_booking_sms,
   receive_application_email, receive_booking_email,
   priority_only, paused)
VALUES
  ('Coach Jared', 'owner', '+12042294913', 'jaredjamesfit@gmail.com',
   true, true, true, true, false, false)
ON CONFLICT DO NOTHING;

-- If a row for this phone OR email already exists, make sure the flags + contact info are current.
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
