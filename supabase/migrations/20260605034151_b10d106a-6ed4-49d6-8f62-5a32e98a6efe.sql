
UPDATE public.agreement_templates
   SET is_active = true,
       archived = false
 WHERE signnow_template_id IS NOT NULL
   AND name IN (
     'Liability waiver',
     'Coaching Agreement - Minor (under 18)',
     'Coaching Agreement (Payor - on the clients behalf)',
     'Coaching Agreement',
     'Complimentary Session - Liability Waiver - PAR-Q'
   );

UPDATE public.agreement_templates
   SET is_active = false,
       archived = true
 WHERE signnow_template_id IS NOT NULL
   AND name NOT IN (
     'Liability waiver',
     'Coaching Agreement - Minor (under 18)',
     'Coaching Agreement (Payor - on the clients behalf)',
     'Coaching Agreement',
     'Complimentary Session - Liability Waiver - PAR-Q'
   );
